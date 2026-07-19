# 🎯 Indovina la Parola — Gioco Sincronizzato (Speaker & Guessr)

Web app real-time a due dispositivi, costruita con **Node.js + Express + Socket.io**
(backend) e **HTML/CSS/JavaScript vanilla** (frontend).

- Il **Device_Speaker** vede la parola e descrive; il **Device_Guessr** vede solo
  il timer e un enorme pulsante rosso per fermare il tempo.
- Il server è l'**unico arbitro** di tempo e punteggio: nessuna logica di gioco
  critica vive nel client.
- Persistenza su file locali: `parole.txt` (dizionario) e `leaderboard.json`
  (storico punteggi).

---

## 📁 Struttura del progetto

```
word-guess-app/
├── server.js           # Backend Express + Socket.io + persistenza su file
├── package.json
├── parole.txt           # Dizionario, una parola per riga
├── leaderboard.json     # Storico punteggi (array di oggetti JSON)
├── public/
│   ├── index.html        # UI unica (home / speaker / guessr / game over)
│   ├── style.css          # Stile + split-screen specchiato per lo Speaker
│   └── app.js              # Logica client + gestione socket.io
└── README.md
```

---

## 🚀 Avvio in locale

Requisiti: **Node.js >= 18**

```bash
cd word-guess-app
npm install
npm start
```

Il server parte su `http://localhost:3000` (o sulla porta indicata da
`process.env.PORT`, se presente).

Apri l'app su **due dispositivi/finestre diverse**:
1. Sul primo, inserisci un nome squadra (opzionale) e premi
   **"Crea Partita (Speaker)"** → ottieni un codice a 4 cifre.
2. Sul secondo, inserisci lo stesso codice e premi
   **"Partecipa (Guessr)"**.

> 💡 Per testare da due browser sullo stesso PC, apri una finestra normale
> e una in incognito (per evitare eventuali conflitti di sessione).

---

## 🎮 Regole del gioco

1. Lo **Speaker** preme **GENERA**: il server estrae una parola casuale dal
   dizionario, la invia **solo** allo Speaker e avvia un timer di 60s
   sincronizzato su entrambi i device.
2. Il **Guessr** ascolta la descrizione. Quando pensa che la squadra abbia
   indovinato, preme il **pulsante rosso PAUSA**: il timer si ferma su
   entrambi i dispositivi.
3. Lo Speaker, in pausa, valuta con **✅ Giusto (+1)** o **❌ Sbagliato (-1,
   minimo 0)**. Il server salva subito una nuova parola e fa ripartire il
   timer da dove si era fermato.
4. In alternativa, durante la pausa il Guessr può premere **⏭️ SKIP**
   (massimo 3 per partita): nessuna penalità, nuova parola e timer ripreso.
5. Allo scadere del tempo, lo Speaker sceglie l'esito dell'ultima parola tra
   **Giusto / Sbagliato / Non Risposto**: la partita termina e il punteggio
   finale viene salvato in `leaderboard.json`.

### Aggiungere parole
Dalla Home, chiunque può proporre una nuova parola: viene normalizzata
(trim + minuscolo), controllata contro i duplicati e — se assente — aggiunta
sia al `Set` in memoria sia in coda al file `parole.txt` (persistenza
permanente finché il filesystem dell'host resta vivo).

---

## 🖥️ Split-screen specchiato (Device_Speaker)

In modalità Speaker, lo schermo (in **orizzontale/landscape**) è diviso
esattamente a metà:
- Metà sinistra: lettura normale.
- Metà destra: ruotata di `180deg` via CSS (`transform: rotate(180deg)`),
  per permettere a due persone sedute ai lati opposti di un tavolo di
  leggere contemporaneamente la stessa parola e lo stesso timer.

Entrambe le metà contengono gli stessi controlli (GENERA / Giusto-Sbagliato
/ Giusto-Sbagliato-Non Risposto), così chiunque tenga in mano il tablet può
interagire da entrambi i lati.

Se il dispositivo è in verticale, viene mostrato un avviso che invita a
ruotarlo.

---

## 🌐 Deployment su hosting gratuiti (Render / Railway)

L'app è pensata per essere deployata senza modifiche su piattaforme come
**Render** o **Railway**:

1. **Carica il progetto** su un repository Git (GitHub/GitLab).
2. Su Render/Railway, crea un nuovo **Web Service** collegato al repo.
3. Imposta:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Node version:** >= 18 (specificata anche in `package.json` → `engines`)
4. Il server legge automaticamente `process.env.PORT`, fornito dalla
   piattaforma: nessuna configurazione aggiuntiva necessaria.
5. Al primo avvio, se `parole.txt` o `leaderboard.json` non esistono, il
   server li crea automaticamente (vuoti/di default).

### ⚠️ Nota sulla persistenza in hosting "free tier"
Molti servizi gratuiti (Render free, Railway free, ecc.) usano filesystem
**effimeri**: i file scritti a runtime (nuove parole, nuovi punteggi)
sopravvivono finché l'istanza resta attiva, ma possono **azzerarsi** ad ogni
nuovo deploy o riavvio del container. Per una persistenza realmente
duratura in produzione, valuta un disco persistente (es. Render Persistent
Disk) o migra la persistenza su un database esterno (fuori dallo scope di
questa versione, che rispetta il requisito "file locali" della richiesta).

---

## 🔌 Eventi Socket.io (riferimento rapido)

| Evento (client → server) | Payload                     | Descrizione                              |
|---------------------------|------------------------------|-------------------------------------------|
| `create_room`              | `{ teamName }`                | Crea una stanza, ruolo Speaker            |
| `join_room`                 | `{ code, teamName }`          | Entra in una stanza, ruolo Guessr         |
| `generate_word`             | —                              | Speaker richiede una nuova parola         |
| `pause_game`                 | —                              | Guessr preme il pulsante rosso            |
| `answer`                     | `{ result }` (`correct`/`wrong`/`none`) | Speaker valuta la risposta   |
| `skip_word`                   | —                              | Guessr usa uno skip (max 3)               |
| `add_word`                     | `{ word }`                     | Propone una nuova parola al dizionario    |
| `get_leaderboard`               | —                              | Richiede la leaderboard aggiornata        |

| Evento (server → client) | Payload                                | Descrizione                          |
|----------------------------|------------------------------------------|-----------------------------------------|
| `room_created`               | `{ code, teamName }`                     | Conferma creazione stanza (Speaker)     |
| `room_joined`                 | stato stanza                              | Conferma accesso stanza (Guessr)        |
| `guessr_joined`                | stato stanza                              | Notifica allo Speaker                   |
| `word_generated`                | `{ word }`                                | Nuova parola (**solo** allo Speaker)     |
| `timer_start` / `timer_tick`      | `{ duration }` / `{ timeLeft }`             | Sincronizzazione del countdown           |
| `game_paused`                    | `{ timeLeft }`                             | Timer fermato                            |
| `game_resumed`                     | `{ timeLeft }`                             | Nuova parola + timer ripreso              |
| `score_update`                      | `{ score }`                                | Punteggio aggiornato                      |
| `skip_update`                        | `{ skipsUsed, maxSkips }`                   | Contatore skip aggiornato                 |
| `time_up`                             | `{ word, score }`                            | Tempo scaduto, richiesta scelta finale     |
| `game_over`                             | `{ finalScore, teamName }`                    | Fine partita, punteggio salvato             |
| `leaderboard_update`                     | array leaderboard                              | Leaderboard aggiornata (broadcast globale)   |
| `join_error` / `error_message`             | `{ message }`                                    | Errori generici                                |

---

## 🛠️ Possibili estensioni future
- Timer di round configurabile dall'utente.
- Autenticazione leggera per evitare stanze "rubate" da terzi con lo stesso codice.
- Persistenza su database (SQLite/PostgreSQL) per ambienti con filesystem effimero.
- Categoria/difficoltà delle parole.
