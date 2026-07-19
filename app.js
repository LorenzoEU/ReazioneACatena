/**
 * app.js
 * ------------------------------------------------------------------
 * Logica frontend (vanilla JS). Gestisce:
 *  - connessione Socket.io
 *  - navigazione tra le schermate (home / speaker / guessr / gameover)
 *  - aggiornamento del DOM in base agli eventi ricevuti dal server
 *  - invio delle azioni utente (crea stanza, join, genera, pausa, skip, risposte)
 *
 * Il server è l'UNICA fonte di verità per tempo e punteggio:
 * questo file si limita a riflettere lo stato ricevuto via socket.
 * ------------------------------------------------------------------
 */

const socket = io();

// ---- Stato locale minimo (solo per la UI, non autoritativo) ----
let currentRole = null;   // 'speaker' | 'guessr'
let currentRoomCode = null;
let currentTeamName = '';

// ==================================================================
// UTILITY: NAVIGAZIONE SCHERMATE
// ==================================================================
const screens = {
  home: document.getElementById('screen-home'),
  speaker: document.getElementById('screen-speaker'),
  guessr: document.getElementById('screen-guessr'),
  gameover: document.getElementById('screen-gameover')
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[name].classList.add('active');
}

// ==================================================================
// HOME: riferimenti DOM
// ==================================================================
const inputTeamName = document.getElementById('input-team-name');
const btnCreateRoom = document.getElementById('btn-create-room');
const inputRoomCode = document.getElementById('input-room-code');
const btnJoinRoom = document.getElementById('btn-join-room');
const homeError = document.getElementById('home-error');

const inputNewWord = document.getElementById('input-new-word');
const btnAddWord = document.getElementById('btn-add-word');
const addWordFeedback = document.getElementById('add-word-feedback');
const wordsCountLabel = document.getElementById('words-count-label');

const leaderboardList = document.getElementById('leaderboard-list');

// ==================================================================
// HOME: azioni utente
// ==================================================================
btnCreateRoom.addEventListener('click', () => {
  homeError.textContent = '';
  currentTeamName = inputTeamName.value.trim();
  socket.emit('create_room', { teamName: currentTeamName });
});

btnJoinRoom.addEventListener('click', () => {
  homeError.textContent = '';
  const code = inputRoomCode.value.trim();
  if (!/^\d{4}$/.test(code)) {
    homeError.textContent = 'Inserisci un codice valido a 4 cifre.';
    return;
  }
  currentTeamName = inputTeamName.value.trim();
  socket.emit('join_room', { code, teamName: currentTeamName });
});

btnAddWord.addEventListener('click', () => {
  const word = inputNewWord.value.trim();
  if (!word) return;
  socket.emit('add_word', { word });
});
inputNewWord.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAddWord.click();
});

socket.on('add_word_result', ({ added, reason, word, count }) => {
  wordsCountLabel.textContent = `Parole nel dizionario: ${count}`;
  if (added) {
    addWordFeedback.style.color = 'var(--color-success)';
    addWordFeedback.textContent = `"${word}" aggiunta con successo!`;
    inputNewWord.value = '';
  } else if (reason === 'duplicate') {
    addWordFeedback.style.color = 'var(--color-warning)';
    addWordFeedback.textContent = `"${word}" è già presente nel dizionario.`;
  } else {
    addWordFeedback.style.color = 'var(--color-danger)';
    addWordFeedback.textContent = 'Inserisci una parola valida.';
  }
});

socket.on('words_count', ({ count }) => {
  wordsCountLabel.textContent = `Parole nel dizionario: ${count}`;
});

// ---- Leaderboard ----
function renderLeaderboard(data) {
  leaderboardList.innerHTML = '';
  if (!data || data.length === 0) {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">Nessun punteggio ancora registrato.</li>';
    return;
  }
  data.slice(0, 15).forEach((entry) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(entry.squadra)}</span><span>${entry.punteggio} pt</span>`;
    leaderboardList.appendChild(li);
  });
}

socket.on('leaderboard_update', (data) => renderLeaderboard(data));

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================================================================
// GESTIONE ERRORI GENERICI
// ==================================================================
socket.on('join_error', ({ message }) => {
  homeError.textContent = message;
});

socket.on('error_message', ({ message }) => {
  // Mostrato come alert semplice indipendentemente dallo schermo attivo
  alert(message);
});

// ==================================================================
// SPEAKER: riferimenti DOM (duplicati nelle due metà specchiate)
// ==================================================================
const speakerRoomCodeEls = document.querySelectorAll('#screen-speaker .js-room-code');
const speakerTeamNameEls = document.querySelectorAll('#screen-speaker .js-team-name');
const speakerTimerEls = document.querySelectorAll('#screen-speaker .js-timer');
const speakerWordEls = document.querySelectorAll('#screen-speaker .js-word');
const speakerScoreEls = document.querySelectorAll('#screen-speaker .js-score');

const speakerControlsPlaying = document.querySelectorAll('.js-controls-playing');
const speakerControlsPaused = document.querySelectorAll('.js-controls-paused');
const speakerControlsTimeup = document.querySelectorAll('.js-controls-timeup');

const speakerOverlay = document.getElementById('speaker-overlay');
const speakerOverlayTitle = document.getElementById('speaker-overlay-title');
const speakerOverlayText = document.getElementById('speaker-overlay-text');
const speakerBigCode = document.getElementById('speaker-big-code');

function setAllText(nodeList, text) {
  nodeList.forEach((el) => (el.textContent = text));
}

function setAllHidden(nodeList, hidden) {
  nodeList.forEach((el) => el.classList.toggle('hidden', hidden));
}

// Bottoni GENERA (presenti in entrambe le metà)
document.querySelectorAll('.js-btn-generate').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('generate_word'));
});
// Bottoni Giusto/Sbagliato (pausa a metà round)
document.querySelectorAll('.js-btn-correct').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('answer', { result: 'correct' }));
});
document.querySelectorAll('.js-btn-wrong').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('answer', { result: 'wrong' }));
});
// Bottoni scelta finale (tempo scaduto)
document.querySelectorAll('.js-btn-correct-final').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('answer', { result: 'correct' }));
});
document.querySelectorAll('.js-btn-wrong-final').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('answer', { result: 'wrong' }));
});
document.querySelectorAll('.js-btn-none-final').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('answer', { result: 'none' }));
});

function showSpeakerControls(mode) {
  // mode: 'playing' | 'paused' | 'timeup'
  setAllHidden(speakerControlsPlaying, mode !== 'playing');
  setAllHidden(speakerControlsPaused, mode !== 'paused');
  setAllHidden(speakerControlsTimeup, mode !== 'timeup');
}

// ==================================================================
// GUESSR: riferimenti DOM
// ==================================================================
const guessrRoomCodeEl = document.querySelector('#screen-guessr .js-room-code');
const guessrTeamNameEl = document.querySelector('#screen-guessr .js-team-name');
const guessrTimerEl = document.querySelector('#screen-guessr .js-timer');
const guessrScoreEl = document.querySelector('#screen-guessr .js-score');
const guessrStatus = document.getElementById('guessr-status');
const btnPause = document.getElementById('btn-pause');
const skipArea = document.getElementById('guessr-skip-area');
const btnSkip = document.getElementById('btn-skip');
const skipsUsedEl = document.querySelector('.js-skips-used');
const skipsMaxEl = document.querySelector('.js-skips-max');
const guessrOverlay = document.getElementById('guessr-overlay');
const guessrOverlayTitle = document.getElementById('guessr-overlay-title');
const guessrOverlayText = document.getElementById('guessr-overlay-text');

btnPause.addEventListener('click', () => {
  socket.emit('pause_game');
});
btnSkip.addEventListener('click', () => {
  socket.emit('skip_word');
});

// ==================================================================
// GAME OVER: riferimenti DOM
// ==================================================================
const gameoverTeamEl = document.querySelector('.js-gameover-team');
const gameoverScoreEl = document.querySelector('.js-gameover-score');
const btnBackHome = document.getElementById('btn-back-home');

btnBackHome.addEventListener('click', () => {
  window.location.reload(); // modo più semplice e robusto per ripartire puliti
});

// ==================================================================
// EVENTI SERVER: CREAZIONE / ACCESSO STANZA
// ==================================================================
socket.on('room_created', ({ code, teamName }) => {
  currentRole = 'speaker';
  currentRoomCode = code;
  currentTeamName = teamName;

  setAllText(speakerRoomCodeEls, code);
  setAllText(speakerTeamNameEls, teamName || '');
  showSpeakerControls('playing');

  showScreen('speaker');
  speakerOverlay.classList.remove('hidden');
  speakerOverlayTitle.textContent = 'In attesa del Guessr…';
  speakerOverlayText.textContent = 'Comunica il codice stanza al secondo giocatore.';
  speakerBigCode.textContent = code;
});

socket.on('guessr_joined', () => {
  speakerOverlay.classList.add('hidden');
});

socket.on('room_joined', (state) => {
  currentRole = 'guessr';
  currentRoomCode = state.code;
  currentTeamName = state.teamName;

  guessrRoomCodeEl.textContent = state.code;
  guessrTeamNameEl.textContent = state.teamName || '';
  guessrTimerEl.textContent = state.timeLeft;
  guessrScoreEl.textContent = state.score;
  skipsUsedEl.textContent = state.skipsUsed;
  skipsMaxEl.textContent = state.maxSkips;

  showScreen('guessr');
  guessrOverlay.classList.remove('hidden');
  guessrOverlayTitle.textContent = 'Connesso alla stanza!';
  guessrOverlayText.textContent = 'Aspetta che lo Speaker generi la prima parola…';
  setTimeout(() => guessrOverlay.classList.add('hidden'), 1800);

  guessrStatus.textContent = 'In attesa che lo Speaker generi una parola…';
  btnPause.disabled = true;
});

// ==================================================================
// EVENTI SERVER: FLUSSO DI GIOCO
// ==================================================================

// Parola generata -> arriva SOLO allo Speaker
socket.on('word_generated', ({ word }) => {
  setAllText(speakerWordEls, word);
  showSpeakerControls('playing');
});

// Il countdown parte -> arriva a ENTRAMBI
socket.on('timer_start', ({ duration }) => {
  setAllText(speakerTimerEls, duration);
  guessrTimerEl.textContent = duration;
  guessrTimerEl.classList.remove('timer-warning');
  speakerTimerEls.forEach((el) => el.classList.remove('timer-warning'));

  if (currentRole === 'guessr') {
    btnPause.disabled = false;
    skipArea.classList.add('hidden');
    guessrStatus.textContent = 'Ascolta la descrizione e premi PAUSA quando pensi di aver indovinato!';
  }
});

// Tick del timer -> arriva a ENTRAMBI ogni secondo
socket.on('timer_tick', ({ timeLeft }) => {
  setAllText(speakerTimerEls, timeLeft);
  guessrTimerEl.textContent = timeLeft;

  const warning = timeLeft <= 10;
  speakerTimerEls.forEach((el) => el.classList.toggle('timer-warning', warning));
  guessrTimerEl.classList.toggle('timer-warning', warning);
});

// Il Guessr ha premuto PAUSA
socket.on('game_paused', ({ timeLeft }) => {
  setAllText(speakerTimerEls, timeLeft);
  guessrTimerEl.textContent = timeLeft;

  showSpeakerControls('paused');

  if (currentRole === 'guessr') {
    btnPause.disabled = true;
    skipArea.classList.remove('hidden');
    guessrStatus.textContent = 'In pausa: lo Speaker sta valutando la risposta…';
  }
});

// La partita riprende dopo una risposta o uno skip (nuova parola + timer)
socket.on('game_resumed', ({ timeLeft }) => {
  showSpeakerControls('playing');
  setAllText(speakerTimerEls, timeLeft);
  guessrTimerEl.textContent = timeLeft;

  if (currentRole === 'guessr') {
    btnPause.disabled = false;
    skipArea.classList.add('hidden');
    guessrStatus.textContent = 'Ascolta la descrizione e premi PAUSA quando pensi di aver indovinato!';
  }
});

// Aggiornamento punteggio
socket.on('score_update', ({ score }) => {
  setAllText(speakerScoreEls, score);
  guessrScoreEl.textContent = score;
});

// Aggiornamento contatore skip
socket.on('skip_update', ({ skipsUsed, maxSkips }) => {
  skipsUsedEl.textContent = skipsUsed;
  skipsMaxEl.textContent = maxSkips;
  if (skipsUsed >= maxSkips) {
    btnSkip.disabled = true;
    btnSkip.textContent = 'Skip esauriti';
  }
});

// Tempo scaduto -> lo Speaker deve scegliere l'esito finale
socket.on('time_up', ({ score }) => {
  showSpeakerControls('timeup');
  setAllText(speakerScoreEls, score);

  if (currentRole === 'guessr') {
    btnPause.disabled = true;
    skipArea.classList.add('hidden');
    guessrStatus.textContent = '⏰ Tempo scaduto! Lo Speaker sta registrando il risultato finale…';
  }
});

// Fine partita -> punteggio salvato in leaderboard
socket.on('game_over', ({ finalScore, teamName }) => {
  gameoverTeamEl.textContent = teamName ? `Squadra: ${teamName}` : '';
  gameoverScoreEl.textContent = finalScore;
  showScreen('gameover');
});

// Disconnessione dell'altro device
socket.on('peer_disconnected', ({ role }) => {
  const label = role === 'speaker' ? 'Speaker' : 'Guessr';
  alert(`${label} si è disconnesso dalla stanza.`);
});

// Richiesta leaderboard iniziale (in caso di reload sulla home)
socket.emit('get_leaderboard');
