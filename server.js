/**
 * server.js
 * ------------------------------------------------------------------
 * Backend del gioco "Indovina la Parola" a due dispositivi sincronizzati
 * (Device_Speaker e Device_Guessr) tramite Socket.io.
 *
 * Responsabilità del server:
 *  - Servire i file statici del frontend (cartella /public)
 *  - Gestire le "stanze" (room) identificate da un codice a 4 cifre
 *  - Essere l'UNICO arbitro del tempo e del punteggio (autorità di gioco)
 *  - Persistere su file locali:
 *      - parole.txt      -> elenco parole (Set in memoria + file su disco)
 *      - leaderboard.json -> storico punteggi delle squadre
 *
 * Ottimizzato per hosting gratuiti (Render/Railway):
 *  - Usa process.env.PORT
 *  - Nessuna dipendenza da database esterni: tutto su filesystem locale
 *    (attenzione: su alcuni host "free tier" il filesystem NON è persistente
 *     tra un deploy e l'altro / tra restart del container: i dati restano
 *     validi finché l'istanza resta viva, si "resettano" ad ogni redeploy).
 * ------------------------------------------------------------------
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.static('.'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // per semplicità di deploy su Render/Railway con dominio dinamico
});

const PORT = process.env.PORT || 3000;
const WORDS_FILE = path.join(__dirname, 'parole.txt');
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
const ROUND_DURATION = 60; // durata del round in secondi
const MAX_SKIPS = 3;       // skip massimi disponibili al Guessr per partita



// ==================================================================
// PERSISTENZA: PAROLE (parole.txt -> Set in memoria)
// ==================================================================

/** Set delle parole caricate in memoria (evita duplicati "gratis") */
let wordsSet = new Set();

function loadWords() {
  try {
    if (!fs.existsSync(WORDS_FILE)) {
      fs.writeFileSync(WORDS_FILE, '', 'utf-8');
    }
    const content = fs.readFileSync(WORDS_FILE, 'utf-8');
    wordsSet = new Set(
      content
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0)
    );
    console.log(`[parole] Caricate ${wordsSet.size} parole da parole.txt`);
  } catch (err) {
    console.error('[parole] Errore durante il caricamento:', err);
    wordsSet = new Set();
  }
}

/**
 * Normalizza (trim + lowercase), verifica duplicati e, se assente,
 * aggiunge la parola sia al Set in memoria sia in coda al file su disco.
 */
function addWord(rawWord) {
  const word = String(rawWord || '').trim().toLowerCase();
  if (!word) return { added: false, reason: 'empty' };
  if (wordsSet.has(word)) return { added: false, reason: 'duplicate' };

  wordsSet.add(word);
  fs.appendFile(WORDS_FILE, word + '\n', (err) => {
    if (err) console.error('[parole] Errore scrittura su file:', err);
  });
  return { added: true };
}

/** Estrae una parola casuale, evitando ripetizioni nella partita corrente */
function pickRandomWord(room) {
  if (wordsSet.size === 0) return null;

  const available = [...wordsSet].filter((w) => !room.usedWords.has(w));
  const pool = available.length > 0 ? available : [...wordsSet];

  const word = pool[Math.floor(Math.random() * pool.length)];

  // Se avevamo esaurito le parole "nuove", ricominciamo il ciclo
  if (available.length === 0) {
    room.usedWords = new Set([word]);
  } else {
    room.usedWords.add(word);
  }
  return word;
}

// ==================================================================
// PERSISTENZA: LEADERBOARD (leaderboard.json)
// ==================================================================

function loadLeaderboard() {
  try {
    if (!fs.existsSync(LEADERBOARD_FILE)) {
      fs.writeFileSync(LEADERBOARD_FILE, '[]', 'utf-8');
    }
    const content = fs.readFileSync(LEADERBOARD_FILE, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('[leaderboard] Errore lettura file:', err);
    return [];
  }
}

function saveScore(squadra, punteggio) {
  const leaderboard = loadLeaderboard();
  leaderboard.push({
    squadra: squadra && squadra.trim() ? squadra.trim() : 'Squadra senza nome',
    punteggio,
    data: new Date().toISOString()
  });
  // Ordiniamo per punteggio decrescente
  leaderboard.sort((a, b) => b.punteggio - a.punteggio);

  fs.writeFile(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2), (err) => {
    if (err) console.error('[leaderboard] Errore scrittura file:', err);
  });
  return leaderboard;
}

loadWords();

// ==================================================================
// GESTIONE STANZE (ROOMS)
// ==================================================================

/** rooms[code] = { ...stato della partita... } */
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000)); // 4 cifre
  } while (rooms[code]);
  return code;
}

function createRoom(code, teamName) {
  rooms[code] = {
    code,
    teamName: teamName || '',
    speakerId: null,
    guessrId: null,
    state: 'waiting',      // waiting | playing | paused | timeup | finished
    currentWord: null,
    timeLeft: ROUND_DURATION,
    timerInterval: null,
    score: 0,
    skipsUsed: 0,
    maxSkips: MAX_SKIPS,
    usedWords: new Set()
  };
  return rooms[code];
}

function clearRoomTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

/** Avvia (o riprende) il countdown server-side, unica fonte di verità del tempo */
function startTimer(room) {
  clearRoomTimer(room);
  room.state = 'playing';
  room.timerInterval = setInterval(() => {
    room.timeLeft -= 1;
    io.to(room.code).emit('timer_tick', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearRoomTimer(room);
      room.timeLeft = 0;
      room.state = 'timeup';
      io.to(room.code).emit('time_up', { word: room.currentWord, score: room.score });
    }
  }, 1000);
}

function pauseTimer(room) {
  clearRoomTimer(room);
  room.state = 'paused';
}

function roomPublicState(room) {
  return {
    code: room.code,
    teamName: room.teamName,
    state: room.state,
    timeLeft: room.timeLeft,
    score: room.score,
    skipsUsed: room.skipsUsed,
    maxSkips: room.maxSkips,
    hasGuessr: !!room.guessrId,
    hasSpeaker: !!room.speakerId
  };
}

/** Chiude la partita, salva il punteggio finale e notifica entrambi i device */
function endGame(room) {
  clearRoomTimer(room);
  room.state = 'finished';
  const updatedLeaderboard = saveScore(room.teamName, room.score);
  io.to(room.code).emit('game_over', { finalScore: room.score, teamName: room.teamName });
  io.emit('leaderboard_update', updatedLeaderboard); // aggiorna la leaderboard per tutti i client connessi
}

// ==================================================================
// SOCKET.IO - EVENTI IN TEMPO REALE
// ==================================================================

io.on('connection', (socket) => {
  console.log('[socket] Nuova connessione:', socket.id);

  // Info iniziali utili alla schermata Home
  socket.emit('words_count', { count: wordsSet.size });
  socket.emit('leaderboard_update', loadLeaderboard());

  // ---- Leaderboard on-demand ----
  socket.on('get_leaderboard', () => {
    socket.emit('leaderboard_update', loadLeaderboard());
  });

  // ---- Aggiunta parola al dizionario condiviso ----
  socket.on('add_word', ({ word }) => {
    const result = addWord(word);
    socket.emit('add_word_result', { ...result, word, count: wordsSet.size });
  });

  // ---- Creazione stanza (Device_Speaker) ----
  socket.on('create_room', ({ teamName }) => {
    const code = generateRoomCode();
    const room = createRoom(code, teamName);
    room.speakerId = socket.id;

    socket.join(code);
    socket.data.role = 'speaker';
    socket.data.roomCode = code;

    socket.emit('room_created', { code, teamName: room.teamName });
    console.log(`[room ${code}] Creata da Speaker (${socket.id}) - squadra: "${room.teamName}"`);
  });

  // ---- Accesso stanza (Device_Guessr) ----
  socket.on('join_room', ({ code, teamName }) => {
    const room = rooms[code];

    if (!room) {
      socket.emit('join_error', { message: 'Stanza non trovata. Controlla il codice.' });
      return;
    }
    if (room.guessrId) {
      socket.emit('join_error', { message: 'Questa stanza ha già un Guessr collegato.' });
      return;
    }

    room.guessrId = socket.id;
    if (!room.teamName && teamName) room.teamName = teamName;

    socket.join(code);
    socket.data.role = 'guessr';
    socket.data.roomCode = code;

    socket.emit('room_joined', roomPublicState(room));
    if (room.speakerId) {
      io.to(room.speakerId).emit('guessr_joined', roomPublicState(room));
    }
    console.log(`[room ${code}] Guessr collegato (${socket.id})`);
  });

  // ---- Lo Speaker chiede una nuova parola ----
  socket.on('generate_word', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || socket.data.role !== 'speaker') return;

    const word = pickRandomWord(room);
    if (!word) {
      socket.emit('error_message', { message: 'Nessuna parola disponibile. Aggiungine una dalla Home!' });
      return;
    }

    room.currentWord = word;
    room.timeLeft = ROUND_DURATION;

    // La parola va SOLO allo Speaker
    io.to(room.speakerId).emit('word_generated', { word });
    // Il countdown parte su ENTRAMBI i device
    io.to(room.code).emit('timer_start', { duration: ROUND_DURATION });
    startTimer(room);
  });

  // ---- Il Guessr preme il pulsante rosso -> pausa ----
  socket.on('pause_game', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'playing') return;

    pauseTimer(room);
    io.to(room.code).emit('game_paused', { timeLeft: room.timeLeft });
  });

  // ---- Lo Speaker risponde: Giusto / Sbagliato / Non Risposto ----
  // Usato sia durante una pausa "a metà round" sia alla scadenza del tempo (timeup)
  socket.on('answer', ({ result }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || socket.data.role !== 'speaker') return;
    if (room.state !== 'paused' && room.state !== 'timeup') return;

    if (result === 'correct') {
      room.score += 1;
    } else if (result === 'wrong') {
      room.score = Math.max(0, room.score - 1); // il punteggio non scende sotto 0
    }
    // result === 'none' (Non Risposto): nessuna variazione di punteggio

    io.to(room.code).emit('score_update', { score: room.score });

    if (room.state === 'timeup') {
      // Tempo scaduto + scelta finale -> fine partita
      endGame(room);
      return;
    }

    // Pausa a metà round risolta -> generiamo subito una nuova parola e riprendiamo il timer
    const word = pickRandomWord(room);
    if (!word) {
      io.to(room.code).emit('error_message', { message: 'Parole esaurite!' });
      return;
    }
    room.currentWord = word;
    io.to(room.speakerId).emit('word_generated', { word });
    io.to(room.code).emit('game_resumed', { timeLeft: room.timeLeft });
    startTimer(room);
  });

  // ---- Il Guessr usa uno SKIP (max 3 a partita, nessuna penalità) ----
  socket.on('skip_word', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || socket.data.role !== 'guessr') return;
    if (room.state !== 'paused') return;

    if (room.skipsUsed >= room.maxSkips) {
      socket.emit('error_message', { message: 'Skip esauriti per questa partita!' });
      return;
    }

    room.skipsUsed += 1;
    io.to(room.code).emit('skip_update', { skipsUsed: room.skipsUsed, maxSkips: room.maxSkips });

    const word = pickRandomWord(room);
    if (word) {
      room.currentWord = word;
      io.to(room.speakerId).emit('word_generated', { word });
    }
    io.to(room.code).emit('game_resumed', { timeLeft: room.timeLeft });
    startTimer(room);
  });

  // ---- Disconnessione ----
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;

    clearRoomTimer(room);
    io.to(code).emit('peer_disconnected', { role: socket.data.role });

    if (room.speakerId === socket.id) room.speakerId = null;
    if (room.guessrId === socket.id) room.guessrId = null;

    // Se la stanza resta vuota, viene eliminata dalla memoria
    if (!room.speakerId && !room.guessrId) {
      delete rooms[code];
      console.log(`[room ${code}] Rimossa (nessun device collegato)`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server in ascolto sulla porta ${PORT}`);
});
