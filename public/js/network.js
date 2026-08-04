// ============================================================================
// network.js — connessione Socket.io e API verso il server autoritativo.
// Il client non prende MAI decisioni di gameplay: invia solo intenti,
// il server risponde con lo stato aggiornato (pubblico + il tuo segreto).
// ============================================================================

// Nessun indirizzo hardcoded: ci si collega sempre allo stesso host/porta da
// cui la pagina è stata servita (funziona identico in locale, in LAN o su un
// dominio/IP pubblico, senza modifiche al codice).
export const socket = io(window.location.origin);

export const state = {
  myId: null,
  lobby: null,        // ultimo "lobby:state" ricevuto
  me: null,            // ultimo "me:secretState" ricevuto
  ghostRoster: null,   // ultimo "ghost:fullState" ricevuto
};

const listeners = {};
export function on(event, cb) {
  (listeners[event] ||= []).push(cb);
}
function emit(event, payload) {
  (listeners[event] || []).forEach(cb => cb(payload));
}

socket.on("connect", () => {
  state.myId = socket.id;
  emit("connected", null);
  syncClock();
});

// ---------------------------------------------------------------------------
// Sincronizzazione orologio: il timer di fase (phaseEndsAt) è un timestamp
// ASSOLUTO deciso dal server. Se l'orologio del dispositivo del client è
// storto (comune su telefono/Termux vs PC), un countdown basato su
// Date.now() nudo mostrerebbe un tempo sbagliato o con drift. Calcoliamo
// quindi un offset (compensato per il round-trip time) e lo riusiamo ovunque
// al posto di Date.now() puro.
// ---------------------------------------------------------------------------
let clockOffset = 0;
function syncClock() {
  const t0 = Date.now();
  socket.emit("time:sync", (serverTime) => {
    const t1 = Date.now();
    const rtt = t1 - t0;
    const estimatedServerNowAtT1 = serverTime + rtt / 2;
    clockOffset = estimatedServerNowAtT1 - t1;
  });
}
setInterval(syncClock, 30_000); // ri-sincronizza periodicamente contro eventuale drift

/** "Adesso", corretto per l'offset con l'orologio del server. Usare SEMPRE
 * questo (mai Date.now() nudo) per confrontare con timestamp del server come
 * lobby.phaseEndsAt. */
export function serverNow() {
  return Date.now() + clockOffset;
}

socket.on("lobby:state", (data) => { state.lobby = data; emit("lobby:state", data); });
socket.on("me:secretState", (data) => { state.me = data; emit("me:secretState", data); });
socket.on("ghost:fullState", (data) => { state.ghostRoster = data; emit("ghost:fullState", data); });
socket.on("chat:message", (msg) => emit("chat:message", msg));
socket.on("vote:progress", (data) => emit("vote:progress", data));
socket.on("reveal:data", (data) => emit("reveal:data", data));
socket.on("investigator:spyResult", (data) => emit("investigator:spyResult", data));
socket.on("mafia:voteUpdate", (data) => emit("mafia:voteUpdate", data));
socket.on("game:ended", (data) => emit("game:ended", data));
socket.on("kicked", (data) => emit("kicked", data));

// ---------------- API (promesse via ack callback del server) ----------------

export function listPublicLobbies() {
  return new Promise((resolve) => socket.emit("lobby:list", (res) => resolve(res)));
}
export function createLobby(playerName, settings) {
  return new Promise((resolve) => socket.emit("lobby:create", { playerName, settings }, (res) => resolve(res)));
}
export function joinLobby(code, playerName) {
  return new Promise((resolve) => socket.emit("lobby:join", { code, playerName }, (res) => resolve(res)));
}
export function startGame() {
  return new Promise((resolve) => socket.emit("lobby:start", (res) => resolve(res)));
}
export function updateSettings(settings) { socket.emit("lobby:updateSettings", settings); }
export function kickPlayer(targetId) { socket.emit("lobby:kick", targetId); }

export function sendNightKill(targetId) { socket.emit("game:nightKill", targetId); }
export function confirmNightKill() { socket.emit("game:nightKillConfirm"); }
export function chooseItem(itemId) { socket.emit("game:chooseItem", itemId); }
export function investigatorSpy(targetId) { socket.emit("game:investigatorSpy", targetId); }
export function closeInvestigatorWindow() { socket.emit("game:investigatorClose"); }
export function castVote(targetIdOrSkip) { socket.emit("game:vote", targetIdOrSkip); }
export function sendChat(text) { socket.emit("chat:send", text); }
export function sendMafiaChat(text) { socket.emit("chat:mafiaSend", text); }
