# Bunker Mafia

Gioco multiplayer 3D di deduzione sociale, giocabile da browser, in stile
Skribbl.io: nessuna installazione client, si entra da un link.

## Stack

- **Backend**: Node.js + TypeScript + Express + Socket.io — **host autoritativo**.
- **Frontend**: HTML/CSS + JavaScript ES Modules + **Three.js** (caricato via CDN
  con `<script type="importmap">`, così non serve alcun bundler/build step per
  il client: apri e giochi).

## Perché niente build-step lato client

Il client usa `import` nativi del browser e un *import map* che punta a Three.js
su CDN (`unpkg`). Questo mantiene il progetto semplice come Skribbl.io: basta
avviare il server Node e servire `public/` staticamente (già fatto da Express).
Se in futuro vuoi Vite/Webpack per bundlare/minificare in produzione, la
struttura in `public/js/*.js` è già modulare e pronta per essere migrata.

## Avvio

```bash
npm install
npm run build   # compila src/*.ts -> dist/*.js
npm start        # avvia il server su http://localhost:3000
```

Oppure in sviluppo con reload automatico:

```bash
npm run dev
```

Apri `http://localhost:3000` in più schede/browser per simulare più giocatori.
Il server ascolta su `0.0.0.0`: è raggiungibile anche da altri dispositivi
sulla stessa rete (es. `http://192.168.1.X:3000`) o da Internet se esponi la
porta 3000 (es. dietro un reverse proxy con un dominio). Il client si collega
sempre automaticamente allo stesso host da cui è stata scaricata la pagina
(`window.location.origin`): nessun indirizzo hardcoded, funziona identico in
locale e in produzione.

Alla primissima apertura della pagina, ogni giocatore sceglie una modalità:
- **Mouse (UI Completa 3D)** — scena Three.js in prima persona + tablet
  che sale dal basso.
- **Touch (UI Minimalista)** — niente scena 3D (risparmio risorse su
  mobile), il tablet occupa da subito tutto lo schermo con le stesse identiche
  funzionalità di gioco. Backend e logica di gioco sono invariati: cambia
  solo cosa viene renderizzato lato client.

## Architettura (file principali)

```
src/
  types.ts          Tipi condivisi (ruoli, fasi, DTO pubblici/privati)
  ItemPool.ts        Pool di oggetti "sopravvivenza" e funzione di estrazione
  Player.ts           Stato server-side di UN giocatore (incluso il segreto:
                       ruolo, opzioni oggetti, scelta, chi lo ha ucciso)
  Game.ts             LA MACCHINA A STATI DI GIOCO (per singola lobby):
                       LOBBY -> NIGHT -> MORNING -> DISCUSSION -> REVEAL -> (loop)
                       Contiene TUTTA la logica di validazione: voti notturni
                       assassino/i, scelta oggetti, spia investigatore, voto
                       diurno, condizioni di vittoria, kick/votekick, ghost chat.
  LobbyManager.ts     Registro di tutte le lobby attive, generazione codici a
                       6 caratteri, elenco lobby pubbliche, pulizia periodica.
  index.ts            Entry point: server HTTP + Express (static) + wiring
                       degli eventi Socket.io verso i metodi di Game.ts.

public/
  index.html          Markup di menu, tablet, HUD, ghost screen, endgame.
  style.css           Tema bunker/hazmat, animazione tablet, vignettatura.
  js/
    network.js         Wrapper sottile su Socket.io: invia SOLO intenti al
                        server, mai stato di gioco calcolato lato client.
    scene.js            Scena Three.js: bunker cilindrico low-poly, tavolo,
                        12 "posti" con placeholder hazmat, luci fredde,
                        camera POV con rotazione lerp guidata dal mouse.
    ui.js               Menu (crea/entra/lista lobby), tabs del tablet,
                        rendering di ogni schermata in base agli eventi
                        ricevuti dal server.
    main.js             Boot: inizializza scena + UI.
```

## Sicurezza / modello di fiducia (IMPORTANTE)

- **Il client non calcola MAI l'esito di un'azione.** Ogni bottone (vota,
  scegli oggetto, kill notturna, spia, kick, join) invia solo un *intento* al
  server (`socket.emit(...)`) e aspetta la risposta/stato aggiornato.
- **Ogni player riceve solo i propri dati segreti.** `Player.toMySecretState()`
  viene inviato via `io.to(playerId).emit("me:secretState", ...)` — MAI in
  broadcast alla stanza. Lo stato pubblico (`lobby:state`) contiene solo
  id/nome/vivo-morto/host, mai ruoli o scelte altrui.
- **L'investigatore** vede una *previsione*: i 3 oggetti che il bersaglio
  sceglierà DOMANI, non quelli di oggi. Il server li pre-genera un turno in
  anticipo (`Player.nextItemOptions`, assegnati in `enterMorning()`), così il
  giorno seguente il bersaglio si ritrova esattamente gli stessi 3 oggetti
  già mostrati all'investigatore. Se il bersaglio è l'assassino, i 3 oggetti
  restano finti e generati al momento (l'assassino non ha mai oggetti reali).
- **Ghost chat**: i messaggi dei morti sono instradati SOLO verso gli altri
  socket dei morti (`handleChat` in `Game.ts` controlla `p.alive` prima di
  scegliere il canale broadcast).
- **Condizione di vittoria generalizzata**: la regola "4 vivi, 3 buoni vs 1
  assassino, viene espulso un innocente -> vittoria immediata assassino" è
  stata generalizzata in `checkWinCondition()`: se `buoni_vivi <= assassini_vivi`
  la partita termina subito (vale anche con 2 o 3 assassini configurati).

## Flusso di gioco implementato

1. **Lobby**: crea (codice a 6 caratteri, pubblica/privata, N assassini 1-3,
   investigatore sì/no, max giocatori fino a 12) o entra per codice/lista.
2. **Mattina (Giorno 1 parte da qui, non dalla Notte)**: vivi non-assassini
   ricevono 3 oggetti a caso e ne scelgono 1; l'assassino vede schermata vuota.
3. **Discussione/Voto**: chat viva attiva, l'investigatore può spiare quante
   volte vuole nella stessa sessione — si blocca SOLO quando chiude
   esplicitamente la finestra ("Chiudi"), fino al giorno successivo; si vota
   chi espellere o "salta".
4. **Rivelazione**: lista anonima e mescolata degli oggetti scelti; esito del
   voto (schermata corretta: ora viene mostrata sempre, anche se si stava
   guardando un'altra tab del tablet — passa automaticamente su "Bunker").
5. **Notte**: ogni assassino (chat privata dedicata, canale "Chat" durante la
   notte) sceglie un bersaglio e preme "Conferma"; con più assassini la kill
   si risolve SOLO quando tutti hanno confermato (maggioranza tra le scelte,
   pareggio → scelta casuale) oppure allo scadere del timer di fase.
6. **Fine giornata / vittoria**: se l'assassino è stato espulso o la parità
   good/evil è raggiunta, la partita termina; altrimenti si torna a Mattina.
7. **Ghost Chat**: i morti vedono il 100% dei dati in tempo reale — ruolo di
   ognuno, oggetti disponibili/scelti, chi ha votato cosa, le bozze/conferme
   di kill notturna degli assassini, E la trascrizione di TUTTI i canali di
   chat (vivi, assassini, fantasmi) via inoltro in sola lettura.

## Timer di fase (anti-AFK, gestiti dal server)

Ogni fase ha una durata massima fissa, calcolata **esclusivamente lato
server** (`Game.ts`, campo `phaseEndsAt = Date.now() + durata`, impostato
SEMPRE prima di qualunque broadcast dello stato, cosi il client riceve
subito il timestamp corretto):

| Fase (nome interno) | Significato               | Durata |
|----------------------|---------------------------|-------:|
| `MORNING`            | Scelta oggetto             |   15s |
| `DISCUSSION`         | Discussione + Votazione    |   75s |
| `REVEAL`              | Rivelazione della morte    |    5s |
| `NIGHT`               | Discussione e Uccisione    |   45s |
| **Totale ciclo**      |                            | **140s** |

Il client (`ui.js`, `tickTimer()`) si limita a mostrare un countdown letto da
questo timestamp assoluto — non decide né calcola nulla. Per evitare che un
orologio di sistema storto (comune tra dispositivi diversi, es. PC vs
telefono/Termux) mostri un conto alla rovescia sbagliato, il client
sincronizza il proprio orologio con quello del server all'avvio e
periodicamente (`network.js`, evento `time:sync`, compensato per il
round-trip time) ed usa sempre `serverNow()` al posto di `Date.now()` puro.

## Controlli mouse (nessuna scorciatoia da tastiera)

- Mouse nei **2/3 superiori** dello schermo: ruota leggermente la camera POV
  (yaw/pitch con lerp fluido) — vedi `setLookTarget()` in `scene.js`.
- Mouse nel **1/3 inferiore** (sotto il 70% dell'altezza, con soglia di
  attivazione al 30% dal basso): il tablet sale con interpolazione lerp.
- **Isteresi**: il tablet scende solo se il mouse torna sopra il 40%
  dell'altezza, per evitare "flickering" quando il cursore oscilla vicino al
  bordo (vedi `tabletUp` / soglie 0.70 / 0.40 in `ui.js`).

## Estendere il gioco

- Aggiungere altri item: modifica `ITEM_POOL` in `src/ItemPool.ts` (attualmente
  26 oggetti tematici da sopravvivenza, nessuno con connotazione di arma).
- Aggiungere modelli 3D reali al posto dei placeholder: vedi `ASSETS.md`.
- Persistenza/reconnect con lo stesso player dopo un refresh: attualmente un
  refresh crea un nuovo socket.id (nuovo giocatore); per un vero reconnect
  andrebbe aggiunto un token di sessione salvato in `sessionStorage` e una
  mappa `sessionToken -> playerId` lato server (non incluso per restare
  entro lo scope richiesto, ma l'architettura di `Game.players: Map` è già
  pronta ad accoglierlo).
