// ============================================================================
// ui.js — Tutta la logica di interfaccia: menu, tablet (mouse-driven), tabs,
// rendering dello stato di gioco ricevuto dal server.
// ============================================================================
import * as Net from "./network.js";

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => [...document.querySelectorAll(sel)];

function isTouchMode() { return document.body.classList.contains("touch-mode"); }

// ----------------------------------------------------------------------------
// MOUSE: rotazione camera (2/3 superiori) + tablet che sale (1/3 inferiore)
// con isteresi per evitare scatti. Disattivo in modalità touch (il tablet è
// già a schermo intero via CSS e non c'è camera 3D da ruotare).
// ----------------------------------------------------------------------------
const tablet = $("#tablet");
let tabletUp = false;
let tabletLerp = 0; // 0 = giù, 1 = su

window.addEventListener("mousemove", (e) => {
  if (isTouchMode()) return;
  const normX = e.clientX / window.innerWidth;
  const normY = e.clientY / window.innerHeight;

  if (normY < 0.66) {
    import("./scene.js").then(({ setLookTarget }) => setLookTarget(normX, normY));
  }

  if (!tabletUp && normY > 0.70) tabletUp = true;      // sale se scende sotto il 30% (100-70)
  else if (tabletUp && normY < 0.40) tabletUp = false; // scende solo se torna sopra il 40% (isteresi)
});

function animateTablet() {
  requestAnimationFrame(animateTablet);
  if (isTouchMode()) return; // in touch mode il CSS lo tiene fisso a schermo intero
  const target = tabletUp ? 1 : 0;
  tabletLerp += (target - tabletLerp) * 0.15;
  const percent = (1 - tabletLerp) * 100;
  tablet.style.transform = `translate(-50%, ${percent}%)`;
}
animateTablet();

// ----------------------------------------------------------------------------
// TABS del tablet
// ----------------------------------------------------------------------------
function activateTab(tabId) {
  $all(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  $all(".tab-panel").forEach(p => p.classList.toggle("active", p.id === tabId));
}
$all(".tab-btn").forEach(btn => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));

// ----------------------------------------------------------------------------
// MENU: home / create / join / list
// ----------------------------------------------------------------------------
function showMenuSub(id) {
  ["menu-home", "menu-create", "menu-join", "menu-list"].forEach(x =>
    $("#" + x).classList.toggle("hidden", x !== id)
  );
}
$("#btn-show-create").onclick = () => showMenuSub("menu-create");
$("#btn-show-join").onclick = () => showMenuSub("menu-join");
$("#btn-show-list").onclick = async () => {
  showMenuSub("menu-list");
  const res = await Net.listPublicLobbies();
  const list = $("#public-lobby-list");
  list.innerHTML = "";
  if (res.ok && res.lobbies.length > 0) {
    for (const l of res.lobbies) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>${l.hostName} — ${l.code} (${l.playerCount}/${l.maxPlayers})</span>`;
      const btn = document.createElement("button");
      btn.textContent = "Entra";
      btn.onclick = () => joinByCode(l.code);
      row.appendChild(btn);
      list.appendChild(row);
    }
  } else {
    list.innerHTML = `<p class="hint">Nessuna lobby pubblica al momento.</p>`;
  }
};
$all("[data-back]").forEach(b => b.onclick = () => showMenuSub("menu-home"));

function setMenuError(msg) { $("#menu-error").textContent = msg || ""; }

$("#btn-create-confirm").onclick = async () => {
  const playerName = $("#input-name").value.trim();
  if (!playerName) return setMenuError("Inserisci un nome.");
  const settings = {
    isPrivate: $("#chk-private").checked,
    numAssassins: Number($("#sel-assassins").value),
    hasInvestigator: $("#chk-investigator").checked,
    maxPlayers: Number($("#input-maxplayers").value),
  };
  const res = await Net.createLobby(playerName, settings);
  if (!res.ok) return setMenuError(res.error);
  enterWaitingRoom();
};

$("#btn-join-confirm").onclick = async () => {
  const playerName = $("#input-name").value.trim();
  const code = $("#input-code").value.trim().toUpperCase();
  if (!playerName) return setMenuError("Inserisci un nome.");
  if (!code) return setMenuError("Inserisci un codice.");
  await joinByCode(code, playerName);
};

async function joinByCode(code, playerNameOverride) {
  const playerName = playerNameOverride || $("#input-name").value.trim();
  if (!playerName) return setMenuError("Inserisci un nome.");
  const res = await Net.joinLobby(code, playerName);
  if (!res.ok) return setMenuError(res.error);
  enterWaitingRoom();
}

function enterWaitingRoom() {
  $("#menu-screen").classList.add("hidden");
  $("#waiting-screen").classList.remove("hidden");
}

// ----------------------------------------------------------------------------
// WAITING ROOM
// ----------------------------------------------------------------------------
$("#btn-start-game").onclick = async () => {
  const res = await Net.startGame();
  if (!res.ok) alert(res.error);
};

$("#btn-copy-code").onclick = async () => {
  const code = Net.state.lobby?.code || "";
  const btn = $("#btn-copy-code");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = "Copiato!";
  } catch (e) {
    // Fallback (es. contesto non sicuro/HTTP semplice): selezioniamo il testo
    // così l'utente può copiarlo manualmente con la sua scorciatoia preferita.
    const range = document.createRange();
    range.selectNodeContents($("#lobby-code-display"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    btn.textContent = "Seleziona e copia";
  }
  setTimeout(() => { btn.textContent = original; }, 1600);
};

function renderWaitingRoom(lobby) {
  $("#lobby-code-display").textContent = lobby.code;
  const list = $("#waiting-player-list");
  list.innerHTML = "";
  let iAmHost = false;
  for (const p of lobby.players) {
    if (p.id === Net.state.myId && p.isHost) iAmHost = true;
    const row = document.createElement("div");
    row.className = "row" + (p.id === Net.state.myId ? " me" : "");
    row.innerHTML = `<span>${p.isHost ? "👑 " : ""}${p.name}</span>`;
    if (iAmHost && p.id !== Net.state.myId) {
      const btn = document.createElement("button");
      btn.textContent = "Kick";
      btn.onclick = () => Net.kickPlayer(p.id);
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  $("#host-controls").classList.toggle("hidden", !iAmHost);
}

// ----------------------------------------------------------------------------
// GAME HUD / PHASE (timer SEMPRE calcolato dal server: phaseEndsAt)
// ----------------------------------------------------------------------------
const PHASE_LABELS = {
  NIGHT: "NOTTE", MORNING: "MATTINA", DISCUSSION: "DISCUSSIONE E VOTO", REVEAL: "RIVELAZIONE", ENDED: "FINE",
};

function tickTimer(lobby) {
  if (!lobby.phaseEndsAt) { $("#phase-timer").textContent = ""; return; }
  const remaining = Math.max(0, Math.round((lobby.phaseEndsAt - Net.serverNow()) / 1000));
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  $("#phase-timer").textContent = `${mm}:${ss}`;
}
setInterval(() => { if (Net.state.lobby) tickTimer(Net.state.lobby); }, 250);

function renderGameHud(lobby, me) {
  $("#phase-name").textContent = `${PHASE_LABELS[lobby.phase] || lobby.phase} — Giorno ${lobby.dayNumber}`;
  const badge = $("#role-badge");
  const roleLabel = { ASSASSINO: "ASSASSINO", INVESTIGATORE: "INVESTIGATORE", INNOCENTE: "INNOCENTE" }[me?.role];
  badge.textContent = roleLabel || "";
  $("#tab-btn-investigator").classList.toggle("hidden", me?.role !== "INVESTIGATORE");
}

// ----------------------------------------------------------------------------
// TAB: MAIN (scelta oggetti / kill notturna con conferma / rivelazione)
// ----------------------------------------------------------------------------
let myNightPick = null;       // bersaglio scelto localmente (in attesa di conferma)
let myNightConfirmed = false; // true dopo aver premuto "Conferma" (finché dura la notte)
let lastRevealData = null;

function makeItemCard(name, icon, onClick, selected) {
  const card = document.createElement("div");
  card.className = "item-card" + (selected ? " selected" : "");
  card.innerHTML = `<div class="icon-placeholder"></div><div>${name}</div>`;
  if (onClick) card.onclick = onClick;
  return card;
}

function renderMainTab(lobby, me) {
  const title = $("#main-panel-title");
  const grid = $("#item-choices");
  const note = $("#main-panel-note");
  const nightControls = $("#night-kill-controls");
  nightControls.classList.add("hidden");
  grid.innerHTML = "";
  note.textContent = "";

  const myPublic = lobby.players.find(p => p.id === Net.state.myId);
  if (myPublic && !myPublic.alive) {
    title.textContent = "Sei morto";
    note.textContent = "Vai nella schermata Ghost Chat per vedere tutto.";
    return;
  }

  if (lobby.phase === "NIGHT") {
    if (me?.role === "ASSASSINO") {
      title.textContent = "Scegli la tua vittima";
      for (const p of lobby.players) {
        if (p.id === Net.state.myId || !p.alive) continue;
        const selected = myNightPick === p.id;
        grid.appendChild(makeItemCard(p.name, "", () => selectNightTarget(p.id), selected));
      }
      nightControls.classList.remove("hidden");
      $("#btn-confirm-kill").disabled = !myNightPick || myNightConfirmed;
      $("#btn-confirm-kill").textContent = myNightConfirmed ? "In attesa degli altri assassini..." : "Conferma Bersaglio";
    } else {
      title.textContent = "È notte. Attendi...";
      note.textContent = "Gli assassini stanno scegliendo la loro vittima.";
    }
    return;
  }

  if (lobby.phase === "MORNING" || lobby.phase === "DISCUSSION") {
    if (me?.role === "ASSASSINO") {
      title.textContent = "Non hai oggetti — improvvisa in chat!";
      return;
    }
    title.textContent = me?.chosenItemId ? "Hai scelto:" : "Scegli un oggetto";
    for (const item of me?.itemOptions || []) {
      const selected = me.chosenItemId === item.id;
      grid.appendChild(makeItemCard(item.name, item.icon, () => Net.chooseItem(item.id), selected));
    }
    if (me?.chosenItemId && (me.itemOptions || []).length === 0) {
      note.textContent = "Scelta registrata.";
    }
    return;
  }

  if (lobby.phase === "REVEAL") {
    renderRevealContent();
  }
}

function selectNightTarget(targetId) {
  myNightPick = targetId;
  myNightConfirmed = false; // cambiare bersaglio annulla una conferma precedente (coerente col server)
  Net.sendNightKill(targetId);
  masterRender();
}
$("#btn-confirm-kill").onclick = () => {
  if (!myNightPick || myNightConfirmed) return;
  Net.confirmNightKill();
  myNightConfirmed = true;
  $("#btn-confirm-kill").disabled = true;
  $("#btn-confirm-kill").textContent = "In attesa degli altri assassini...";
};

// Lo stato di conferma degli altri assassini arriva in tempo reale via
// mafia:voteUpdate — il server invia anche uno stato azzerato a inizio
// notte, quindi questo box non mostra mai dati della notte precedente.

Net.on("mafia:voteUpdate", (draft) => {
  const container = $("#mafia-status");
  if (!container) return;
  container.innerHTML = "";
  for (const [assassinId, info] of Object.entries(draft)) {
    const row = document.createElement("div");
    row.className = "row" + (info.confirmed ? " confirmed" : "") + (assassinId === Net.state.myId ? " me" : "");
    row.innerHTML = `<span>${assassinId === Net.state.myId ? "Tu" : "Assassino"} → ${info.targetName} ${info.confirmed ? "(confermato)" : "(in attesa)"}</span>`;
    container.appendChild(row);
  }
});

// ----------------------------------------------------------------------------
// TAB: CHAT (di giorno = chat viva; di notte, se sei assassino = chat privata)
// ----------------------------------------------------------------------------
const chatLog = $("#chat-log");
Net.on("chat:message", (msg) => {
  if (msg.channel === "GHOST") return; // gestita in ghost screen
  appendChatLine(chatLog, msg);
});
function appendChatLine(container, msg) {
  const div = document.createElement("div");
  const tagClass = msg.channel === "MAFIA" ? "mafia" : msg.channel === "GHOST" ? "ghost" : "living";
  const tagLabel = msg.channel === "MAFIA" ? "ASSASSINI" : msg.channel === "GHOST" ? "FANTASMI" : "VIVI";
  div.innerHTML = `<span class="chat-tag ${tagClass}">${tagLabel}</span><span class="from">${escapeHtml(msg.from)}:</span> ${escapeHtml(msg.text)}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

$("#chat-send").onclick = sendChat;
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
function sendChat() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  const lobby = Net.state.lobby;
  const me = Net.state.me;
  if (lobby?.phase === "NIGHT" && me?.role === "ASSASSINO") {
    Net.sendMafiaChat(text);
  } else {
    Net.sendChat(text);
  }
  input.value = "";
}

function renderChatTabHeader(lobby, me) {
  const isMafiaChat = lobby.phase === "NIGHT" && me?.role === "ASSASSINO";
  $("#chat-input").placeholder = isMafiaChat
    ? "Messaggio privato agli altri assassini..."
    : "Scrivi un messaggio...";
}

// ----------------------------------------------------------------------------
// TAB: VOTO
// ----------------------------------------------------------------------------
function renderVoteTab(lobby) {
  const list = $("#vote-list");
  list.innerHTML = "";
  const iAmAlive = lobby.players.find(p => p.id === Net.state.myId)?.alive;
  for (const p of lobby.players) {
    if (!p.alive || p.id === Net.state.myId) continue;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${p.name}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Vota";
    btn.disabled = lobby.phase !== "DISCUSSION" || !iAmAlive;
    btn.onclick = () => Net.castVote(p.id);
    row.appendChild(btn);
    list.appendChild(row);
  }
  $("#btn-vote-skip").disabled = lobby.phase !== "DISCUSSION" || !iAmAlive;
}
$("#btn-vote-skip").onclick = () => Net.castVote("SKIP");
Net.on("vote:progress", (data) => {
  $("#vote-progress").textContent = `${data.votedIds.length}/${data.total} hanno votato`;
});

// ----------------------------------------------------------------------------
// TAB: INVESTIGATORE (una sessione al giorno, chiusa esplicitamente col bottone)
// ----------------------------------------------------------------------------
let investigatorResultDay = null; // giorno a cui si riferisce l'ultimo spyResult mostrato

function renderInvestigatorTab(lobby, me) {
  if (me?.role !== "INVESTIGATORE") return;
  // Se è iniziato un nuovo giorno rispetto a quando abbiamo mostrato l'ultimo
  // risultato, il pannello va nascosto: altrimenti resterebbe visibile con
  // la previsione di ieri anche oggi.
  if (investigatorResultDay !== null && investigatorResultDay !== lobby.dayNumber) {
    $("#investigator-result").classList.add("hidden");
    investigatorResultDay = null;
  }
  const locked = !!me.investigatorLocked;
  $("#investigator-locked-note").classList.toggle("hidden", !locked);
  const list = $("#investigator-target-list");
  list.innerHTML = "";
  if (locked) return;
  for (const p of lobby.players) {
    if (!p.alive || p.id === Net.state.myId) continue;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${p.name}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Spia";
    btn.disabled = lobby.phase !== "DISCUSSION" && lobby.phase !== "MORNING";
    btn.onclick = () => Net.investigatorSpy(p.id);
    row.appendChild(btn);
    list.appendChild(row);
  }
}
Net.on("investigator:spyResult", (data) => {
  investigatorResultDay = Net.state.lobby?.dayNumber ?? null;
  $("#investigator-result").classList.remove("hidden");
  $("#investigator-target-name").textContent = "Opzioni di " + data.targetName;
  const grid = $("#investigator-items");
  grid.innerHTML = "";
  for (const item of data.items) grid.appendChild(makeItemCard(item.name, item.icon, null));
});
$("#btn-close-spy").onclick = () => {
  $("#investigator-result").classList.add("hidden");
  Net.closeInvestigatorWindow(); // blocca il potere fino al giorno successivo
};

// ----------------------------------------------------------------------------
// GHOST SCREEN — 100% delle informazioni: ruoli, oggetti, voti, chat di TUTTI
// i canali (vivi, assassini, fantasmi).
// ----------------------------------------------------------------------------
const ghostChatLog = $("#ghost-chat-log");
Net.on("chat:message", (msg) => appendChatLine(ghostChatLog, msg)); // qui mostriamo TUTTI i canali
$("#ghost-chat-send").onclick = sendGhostChat;
$("#ghost-chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendGhostChat(); });
function sendGhostChat() {
  const input = $("#ghost-chat-input");
  if (!input.value.trim()) return;
  Net.sendChat(input.value); // il server instrada in automatico alla ghost chat se sei morto
  input.value = "";
}

Net.on("ghost:fullState", (data) => {
  $("#ghost-screen").classList.remove("hidden");
  const roster = $("#ghost-roster");
  roster.innerHTML = "";

  for (const p of data.players) {
    const row = document.createElement("div");
    row.className = "row" + (p.alive ? "" : " dead");
    const itemsToday = (p.itemOptions || []).map(i => i.name).join(", ") || "—";
    const chosen = p.chosenItemId ? (p.itemOptions.find(i => i.id === p.chosenItemId)?.name || p.chosenItemId) : "—";
    row.innerHTML = `<span><b>${p.name}</b> — ${p.role || "?"} | opzioni: ${itemsToday} | scelto: ${chosen}</span>`;
    roster.appendChild(row);
  }

  if (data.dayVotes?.length) {
    const votesTitle = document.createElement("div");
    votesTitle.className = "hint";
    votesTitle.textContent = "Voti di oggi: " + data.dayVotes.map(v => `${v.voterName}→${v.choiceName}`).join(", ");
    roster.appendChild(votesTitle);
  }
  if (data.nightVotes?.length) {
    const nightTitle = document.createElement("div");
    nightTitle.className = "hint";
    nightTitle.textContent = "Bozze notturne: " + data.nightVotes.map(v => `${v.assassinName}→${v.targetName}${v.confirmed ? " (confermato)" : ""}`).join(", ");
    roster.appendChild(nightTitle);
  }
});

// ----------------------------------------------------------------------------
// REVEAL DATA (lista anonima oggetti + esito voto) — FIX: i dati venivano
// cancellati dal successivo render generico. Ora li conserviamo e li
// ridisegniamo ad ogni masterRender finché siamo in fase REVEAL, e passiamo
// automaticamente alla tab "Bunker" così il giocatore la vede subito.
// ----------------------------------------------------------------------------
function renderRevealContent() {
  if (!lastRevealData) return;
  const grid = $("#item-choices");
  const title = $("#main-panel-title");
  const note = $("#main-panel-note");
  title.textContent = "Oggetti scelti stamattina";
  grid.innerHTML = "";
  for (const entry of lastRevealData.items) {
    grid.appendChild(makeItemCard(`${entry.itemName} ×${entry.count}`, entry.itemId, null));
  }
  note.textContent = lastRevealData.eliminatedName
    ? `${lastRevealData.eliminatedName} è stato espulso. Era ${lastRevealData.wasAssassin ? "l'ASSASSINO" : "un innocente"}.`
    : "Nessuno è stato espulso questo turno.";
}
Net.on("reveal:data", (data) => {
  lastRevealData = data;
  myNightPick = null; myNightConfirmed = false; // si riparte puliti per la notte successiva
  activateTab("tab-main");
  renderRevealContent();
});

// ----------------------------------------------------------------------------
// ENDGAME
// ----------------------------------------------------------------------------
Net.on("game:ended", (data) => {
  $("#ghost-screen").classList.add("hidden");
  $("#endgame-screen").classList.remove("hidden");
  $("#endgame-title").textContent = data.winner === "INNOCENTI" ? "Vincono gli Innocenti!" : "Vince l'Assassino!";
  const roster = $("#endgame-roster");
  roster.innerHTML = "";
  for (const p of data.roster) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${p.name} — <b>${p.role}</b></span>`;
    roster.appendChild(row);
  }
});
$("#btn-back-to-menu").onclick = () => window.location.reload();

Net.on("kicked", (data) => {
  alert(data.reason || "Sei stato rimosso dalla partita.");
  window.location.reload();
});

// ----------------------------------------------------------------------------
// MASTER RENDER: reagisce a ogni nuovo lobby:state / me:secretState
// ----------------------------------------------------------------------------
function masterRender() {
  const lobby = Net.state.lobby;
  const me = Net.state.me;
  if (!lobby) return;

  if (lobby.phase === "LOBBY") {
    $("#waiting-screen").classList.remove("hidden");
    $("#game-hud").classList.add("hidden");
    renderWaitingRoom(lobby);
    return;
  }

  $("#menu-screen").classList.add("hidden");
  $("#waiting-screen").classList.add("hidden");
  $("#game-hud").classList.remove("hidden");

  const myPublic = lobby.players.find(p => p.id === Net.state.myId);
  // La ghost-screen va mostrata solo mentre la partita è ANCORA in corso: a
  // fine partita (ENDED) deve lasciare il posto alla schermata finale,
  // altrimenti (essendo sopra di essa) i giocatori morti non vedrebbero mai
  // né l'esito né il pulsante "Torna al Menu".
  const showGhostScreen = !!(myPublic && !myPublic.alive) && lobby.phase !== "ENDED";
  $("#ghost-screen").classList.toggle("hidden", !showGhostScreen);

  if (lobby.phase !== "NIGHT") { myNightPick = null; myNightConfirmed = false; } // reset quando non è più notte

  renderGameHud(lobby, me);
  renderChatTabHeader(lobby, me);
  renderMainTab(lobby, me);
  renderVoteTab(lobby);
  renderInvestigatorTab(lobby, me);
}

Net.on("lobby:state", masterRender);
Net.on("me:secretState", masterRender);
