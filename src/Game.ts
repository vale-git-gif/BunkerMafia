import { Server } from "socket.io";
import { Player } from "./Player";
import { drawThreeItems, ITEM_POOL } from "./ItemPool";
import { GamePhase, LobbySettings, RevealEntry, ChatMessage } from "./types";

const NIGHT_MS = 45_000;      // "Discussione e Uccisione"
const MORNING_MS = 15_000;    // "Scelta oggetto"
const DISCUSSION_MS = 75_000; // "Discussione" (45s) + "Votazione" (30s) nella stessa fase
const REVEAL_MS = 5_000;      // "Rivelazione della morte"

export class Game {
  public code: string;
  public settings: LobbySettings;
  private io: Server;
  public players: Map<string, Player> = new Map(); // key = socket.id
  public phase: GamePhase = "LOBBY";
  public dayNumber: number = 0;

  private nightKillVotes: Map<string, string> = new Map();     // assassinId -> targetId (bozza)
  private nightKillConfirmed: Set<string> = new Set();          // assassinId che ha premuto "Conferma"
  private dayVotes: Map<string, string> = new Map();        // voterId -> targetId | "SKIP"
  private lastNightVictimId: string | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private phaseEndsAt: number = 0;

  private votekicks: Map<string, Set<string>> = new Map(); // targetId -> set of voter ids

  constructor(code: string, settings: LobbySettings, io: Server) {
    this.code = code;
    this.settings = settings;
    this.io = io;
  }

  // --------------------------------------------------------------------
  // LOBBY MANAGEMENT
  // --------------------------------------------------------------------

  addPlayer(id: string, name: string): { ok: boolean; error?: string } {
    if (this.phase !== "LOBBY") return { ok: false, error: "La partita è già iniziata." };
    if (this.players.size >= this.settings.maxPlayers) return { ok: false, error: "Lobby piena." };
    if ([...this.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "Nome già in uso in questa lobby." };
    }
    const p = new Player(id, name);
    if (this.players.size === 0) p.isHost = true;
    this.players.set(id, p);
    this.broadcastLobbyState();
    return { ok: true };
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    const wasHost = p.isHost;

    if (this.phase === "LOBBY") {
      this.players.delete(id);
      if (wasHost && this.players.size > 0) {
        const next = [...this.players.values()][0];
        next.isHost = true;
      }
    } else {
      // In partita: non rimuoviamo, marchiamo come disconnesso ma restiamo
      // "vivo" ai fini del voto (per non rompere l'equilibrio); lo stato
      // pubblico segnala la disconnessione.
      p.disconnected = true;
    }
    this.broadcastLobbyState();
  }

  kickPlayer(requesterId: string, targetId: string) {
    const requester = this.players.get(requesterId);
    const target = this.players.get(targetId);
    if (!requester || !target) return;
    if (target.alive === false && this.phase !== "LOBBY") return; // già morto, niente da fare

    if (this.phase === "LOBBY") {
      if (!requester.isHost) return;
      this.removePlayer(targetId);
      this.io.to(targetId).emit("kicked", { reason: "Sei stato espulso dall'host." });
      return;
    }

    // In partita: host può kickare direttamente, oppure servono 4 voti
    // da parte di giocatori VIVI (i morti non possono votare il kick).
    if (requester.isHost) {
      this.forceEliminate(targetId, "kick_host");
      return;
    }
    if (!requester.alive) return; // i morti non possono avviare/votare un kick

    if (!this.votekicks.has(targetId)) this.votekicks.set(targetId, new Set());
    this.votekicks.get(targetId)!.add(requesterId);
    if (this.votekicks.get(targetId)!.size >= 4) {
      this.votekicks.delete(targetId);
      this.forceEliminate(targetId, "kick_vote");
    }
  }

  updateSettings(requesterId: string, settings: Partial<LobbySettings>) {
    const requester = this.players.get(requesterId);
    if (!requester || !requester.isHost || this.phase !== "LOBBY") return;
    if (settings.maxPlayers !== undefined) {
      settings.maxPlayers = Math.max(4, this.players.size, Math.min(12, settings.maxPlayers));
    }
    this.settings = { ...this.settings, ...settings };
    this.broadcastLobbyState();
  }

  // --------------------------------------------------------------------
  // START GAME / ROLE ASSIGNMENT
  // --------------------------------------------------------------------

  startGame(requesterId: string): { ok: boolean; error?: string } {
    const requester = this.players.get(requesterId);
    if (!requester || !requester.isHost) return { ok: false, error: "Solo l'host può avviare." };
    if (this.phase !== "LOBBY") return { ok: false, error: "Partita già avviata." };

    const minPlayers = this.settings.numAssassins * 2 + 2; // margine di sicurezza minimo
    if (this.players.size < Math.max(4, minPlayers)) {
      return { ok: false, error: `Servono almeno ${Math.max(4, minPlayers)} giocatori.` };
    }

    this.assignRoles();
    this.dayNumber = 0;
    this.enterMorning(); // la partita comincia dal Giorno 1 (scelta oggetti), non dalla Notte
    return { ok: true };
  }

  private assignRoles() {
    const ids = [...this.players.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    let idx = 0;
    for (let i = 0; i < this.settings.numAssassins; i++) {
      this.players.get(ids[idx++])!.role = "ASSASSINO";
    }
    if (this.settings.hasInvestigator) {
      this.players.get(ids[idx++])!.role = "INVESTIGATORE";
    }
    while (idx < ids.length) {
      this.players.get(ids[idx++])!.role = "INNOCENTE";
    }
  }

  private livingPlayers(): Player[] {
    return [...this.players.values()].filter(p => p.alive);
  }
  private livingAssassins(): Player[] {
    return this.livingPlayers().filter(p => p.role === "ASSASSINO");
  }
  private livingGood(): Player[] {
    return this.livingPlayers().filter(p => p.role !== "ASSASSINO");
  }
  /** Vivi E connessi: usato SOLO per capire quando tutti hanno già agito e si
   * può passare subito alla fase successiva, così un giocatore disconnesso
   * non costringe gli altri ad aspettare l'intero timer inutilmente. Non
   * influisce in alcun modo sulle condizioni di vittoria. */
  private activeLivingPlayers(): Player[] {
    return this.livingPlayers().filter(p => !p.disconnected);
  }

  // --------------------------------------------------------------------
  // PHASE: NIGHT
  // --------------------------------------------------------------------

  private clearTimer() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  private enterNight() {
    this.clearTimer();
    this.phase = "NIGHT";
    this.nightKillVotes.clear();
    this.nightKillConfirmed.clear();
    this.votekicks.clear();
    this.phaseEndsAt = Date.now() + NIGHT_MS; // calcolato PRIMA del broadcast, altrimenti il client riceverebbe il valore della fase precedente
    this.phaseTimer = setTimeout(() => this.resolveNight(), NIGHT_MS);
    this.broadcastLobbyState();
    this.pushSecretStates();
    this.pushGhostState();
    this.broadcastMafiaVoteState(); // stato azzerato: evita che ai client resti visibile la bozza della notte precedente
  }

  /** Chiamato quando un assassino sceglie/cambia un bersaglio (bozza, non ancora confermata). */
  submitNightKillVote(assassinId: string, targetId: string) {
    const assassin = this.players.get(assassinId);
    const target = this.players.get(targetId);
    if (!assassin || !target) return;
    if (this.phase !== "NIGHT") return;
    if (assassin.role !== "ASSASSINO" || !assassin.alive) return;
    if (!target.alive || target.role === "ASSASSINO") return; // no friendly fire
    this.nightKillVotes.set(assassinId, targetId);
    this.nightKillConfirmed.delete(assassinId); // cambiare bersaglio annulla la conferma precedente
    this.broadcastMafiaVoteState();
    this.pushGhostState();
  }

  /** Chiamato quando un assassino preme "Conferma" sul bersaglio scelto. */
  confirmNightKill(assassinId: string) {
    const assassin = this.players.get(assassinId);
    if (!assassin || assassin.role !== "ASSASSINO" || !assassin.alive) return;
    if (this.phase !== "NIGHT") return;
    if (!this.nightKillVotes.has(assassinId)) return; // deve prima scegliere un bersaglio
    this.nightKillConfirmed.add(assassinId);
    this.broadcastMafiaVoteState();
    this.pushGhostState();
    const living = this.livingAssassins().filter(a => !a.disconnected);
    if (living.length > 0 && living.every(a => this.nightKillConfirmed.has(a.id))) {
      this.resolveNight();
    }
  }

  private broadcastMafiaVoteState() {
    const draft: Record<string, { targetId: string; targetName: string; confirmed: boolean }> = {};
    for (const [voterId, targetId] of this.nightKillVotes.entries()) {
      const voter = this.players.get(voterId)!;
      const target = this.players.get(targetId);
      draft[voterId] = {
        targetId,
        targetName: target?.name ?? "?",
        confirmed: this.nightKillConfirmed.has(voterId),
      };
    }
    for (const a of this.livingAssassins()) {
      this.io.to(a.id).emit("mafia:voteUpdate", draft);
    }
  }

  private resolveNight() {
    if (this.phase !== "NIGHT") return;
    this.clearTimer();

    // Determina il bersaglio per maggioranza tra i voti degli assassini vivi.
    const tally = new Map<string, number>();
    for (const target of this.nightKillVotes.values()) {
      tally.set(target, (tally.get(target) || 0) + 1);
    }
    let victimId: string | null = null;
    if (tally.size > 0) {
      let max = -1;
      let candidates: string[] = [];
      for (const [t, c] of tally.entries()) {
        if (c > max) { max = c; candidates = [t]; }
        else if (c === max) candidates.push(t);
      }
      victimId = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // Nessun voto entro il timer: kill forzata su un bersaglio casuale vivo non-assassino.
      const pool = this.livingGood();
      if (pool.length > 0) victimId = pool[Math.floor(Math.random() * pool.length)].id;
    }

    this.lastNightVictimId = victimId;
    if (victimId) {
      const victim = this.players.get(victimId)!;
      victim.alive = false;
      const killerName = this.livingAssassins()[0]?.name ?? "L'Assassino";
      victim.killedBy = this.settings.numAssassins > 1 ? "Gli Assassini" : killerName;
      this.pushGhostState();
    }

    if (this.checkWinCondition()) return;
    this.enterMorning();
  }

  // --------------------------------------------------------------------
  // PHASE: MORNING (scelta oggetti)
  // --------------------------------------------------------------------

  private enterMorning() {
    this.clearTimer();
    this.phase = "MORNING";
    this.dayNumber++;
    for (const p of this.players.values()) {
      p.resetForNewDay(); // pulisce scelta/voto E sblocca il potere dell'investigatore
      if (!p.alive) continue;
      if (p.role === "ASSASSINO") {
        p.itemOptions = []; // schermata vuota, deve bluffare
      } else {
        // Le opzioni di OGGI sono quelle già pre-generate il turno scorso
        // (così l'investigatore che ieri ha "predetto" questi oggetti vede
        // esattamente quelli che il giocatore sceglie oggi). Al Giorno 1 non
        // esiste una previsione precedente: si pesca al momento.
        p.itemOptions = p.nextItemOptions.length > 0 ? p.nextItemOptions : drawThreeItems();
        // Pre-genera SUBITO le opzioni di DOMANI: un turno di anticipo,
        // così l'investigatore può già "prevederle" durante la giornata odierna.
        p.nextItemOptions = drawThreeItems();
      }
    }
    this.phaseEndsAt = Date.now() + MORNING_MS; // calcolato PRIMA del broadcast
    this.phaseTimer = setTimeout(() => this.enterDiscussion(), MORNING_MS);
    this.broadcastLobbyState();
    this.pushSecretStates();
    this.pushGhostState();
  }

  chooseItem(playerId: string, itemId: string) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== "MORNING" || !p.alive) return;
    if (p.role === "ASSASSINO") return; // non ha oggetti
    if (p.chosenItemId) return; // già scelto
    if (!p.itemOptions.some(i => i.id === itemId)) return; // scelta non valida/non tra le sue opzioni
    p.chosenItemId = itemId;
    this.io.to(playerId).emit("me:secretState", p.toMySecretState());
    this.pushGhostState();

    // Se tutti i vivi CONNESSI non-assassini hanno scelto, si passa subito
    // alla discussione (un giocatore disconnesso non blocca gli altri: nel
    // peggiore dei casi si aspetta comunque il timer di fase).
    const pending = this.activeLivingPlayers().filter(pl => pl.role !== "ASSASSINO" && !pl.chosenItemId);
    if (pending.length === 0) this.enterDiscussion();
  }

  // --------------------------------------------------------------------
  // PHASE: DISCUSSION + VOTE + INVESTIGATORE
  // --------------------------------------------------------------------

  private enterDiscussion() {
    this.clearTimer();
    this.phase = "DISCUSSION";
    this.dayVotes.clear();
    for (const p of this.players.values()) p.hasVotedThisRound = false;
    this.phaseEndsAt = Date.now() + DISCUSSION_MS; // calcolato PRIMA del broadcast
    this.phaseTimer = setTimeout(() => this.enterReveal(true), DISCUSSION_MS);
    this.broadcastLobbyState();
    this.pushGhostState();
  }

  /**
   * L'investigatore spia le opzioni attuali di un bersaglio (snapshot, non
   * salvato). Può farlo quante volte vuole, su chiunque, DURANTE la stessa
   * sessione giornaliera: si blocca solo quando chiude esplicitamente la
   * finestra (closeInvestigation), fino al giorno successivo.
   */
  investigatorSpy(investigatorId: string, targetId: string) {
    const inv = this.players.get(investigatorId);
    const target = this.players.get(targetId);
    if (!inv || !target) return;
    if (inv.role !== "INVESTIGATORE" || !inv.alive) return;
    if (inv.investigatorUsedToday) return; // già chiuso oggi: bloccato fino a domani
    if (this.phase !== "DISCUSSION" && this.phase !== "MORNING") return;
    if (!target.alive || target.id === inv.id) return;

    let itemsToShow;
    if (target.role === "ASSASSINO") {
      itemsToShow = drawThreeItems(); // dati fake, generati al momento (l'assassino non ha oggetti reali, né oggi né domani)
    } else {
      // L'investigatore vede una PREVISIONE: i 3 oggetti che il bersaglio
      // sceglierà domani (già pre-generati un turno prima in enterMorning()),
      // non quelli di oggi. Così facendo il giorno dopo il bersaglio vedrà
      // esattamente gli stessi 3 oggetti mostrati qui.
      itemsToShow = target.nextItemOptions;
    }
    this.io.to(investigatorId).emit("investigator:spyResult", {
      targetId: target.id,
      targetName: target.name,
      items: itemsToShow,
    });
    this.pushGhostState();
    // NB: il server non salva/persiste questa vista lato client: se chiude
    // il pannello e lo riapre deve richiederla di nuovo (nuovo snapshot).
  }

  /** L'investigatore chiude la finestra: potere bloccato fino al giorno dopo. */
  closeInvestigation(investigatorId: string) {
    const inv = this.players.get(investigatorId);
    if (!inv || inv.role !== "INVESTIGATORE") return;
    inv.investigatorUsedToday = true;
    this.io.to(investigatorId).emit("me:secretState", inv.toMySecretState());
  }

  castVote(voterId: string, targetIdOrSkip: string) {
    const voter = this.players.get(voterId);
    if (!voter || !voter.alive || this.phase !== "DISCUSSION") return;
    if (targetIdOrSkip !== "SKIP") {
      const target = this.players.get(targetIdOrSkip);
      if (!target || !target.alive) return;
    }
    this.dayVotes.set(voterId, targetIdOrSkip);
    voter.hasVotedThisRound = true;
    this.broadcastVoteProgress();
    this.pushGhostState();

    if (this.dayVotes.size >= this.activeLivingPlayers().length) {
      this.enterReveal(true);
    }
  }

  private broadcastVoteProgress() {
    // Mostra SOLO chi ha votato (non per chi), per non rivelare info in anticipo.
    const votedIds = [...this.dayVotes.keys()];
    this.io.to(this.code).emit("vote:progress", { votedIds, total: this.activeLivingPlayers().length });
  }

  private resolveDayVoteAndEliminate() {
    const tally = new Map<string, number>();
    for (const choice of this.dayVotes.values()) {
      tally.set(choice, (tally.get(choice) || 0) + 1);
    }
    let winner: string | null = null;
    let max = -1;
    let tied: string[] = [];
    for (const [choice, c] of tally.entries()) {
      if (c > max) { max = c; tied = [choice]; }
      else if (c === max) tied.push(choice);
    }
    if (tied.length !== 1) winner = null; // parità totale -> nessuna espulsione
    else winner = tied[0];

    let eliminatedId: string | null = null;
    if (winner && winner !== "SKIP") {
      eliminatedId = winner;
      const p = this.players.get(eliminatedId)!;
      p.alive = false;
      p.killedBy = "Voto della community";
    }
    return eliminatedId;
  }

  // --------------------------------------------------------------------
  // PHASE: REVEAL
  // --------------------------------------------------------------------

  private enterReveal(runElimination: boolean) {
    this.clearTimer();
    this.phase = "REVEAL";

    let eliminatedId: string | null = null;
    if (runElimination) eliminatedId = this.resolveDayVoteAndEliminate();

    // Costruisci lista anonima e mescolata degli oggetti scelti quella mattina.
    const counts = new Map<string, number>();
    for (const p of this.players.values()) {
      if (p.chosenItemId) counts.set(p.chosenItemId, (counts.get(p.chosenItemId) || 0) + 1);
    }
    const reveal: RevealEntry[] = [...counts.entries()]
      .map(([itemId, count]) => {
        const def = ITEM_POOL.find(i => i.id === itemId)!;
        return { itemId, itemName: def.name, count };
      })
      .sort(() => Math.random() - 0.5);

    this.pushGhostState();

    this.phaseEndsAt = Date.now() + REVEAL_MS; // calcolato PRIMA del broadcast
    this.io.to(this.code).emit("reveal:data", {
      eliminatedId,
      eliminatedName: eliminatedId ? this.players.get(eliminatedId)!.name : null,
      wasAssassin: eliminatedId ? this.players.get(eliminatedId)!.role === "ASSASSINO" : null,
      items: reveal,
    });
    this.broadcastLobbyState();

    if (this.checkWinCondition()) return;

    this.phaseTimer = setTimeout(() => this.enterNight(), REVEAL_MS);
  }

  // --------------------------------------------------------------------
  // WIN CONDITIONS
  // --------------------------------------------------------------------

  private checkWinCondition(): boolean {
    const good = this.livingGood().length;
    const evil = this.livingAssassins().length;

    if (evil === 0) {
      this.endGame("INNOCENTI");
      return true;
    }
    // Generalizzazione della regola richiesta: se i buoni non possono più
    // avere una maggioranza netta sugli assassini (parità o inferiorità),
    // la partita è matematicamente persa: notte -> kill -> ancora parità o
    // peggio, quindi gli assassini vincono subito invece di trascinare il game.
    if (good <= evil) {
      this.endGame("ASSASSINI");
      return true;
    }
    return false;
  }

  private endGame(winner: "INNOCENTI" | "ASSASSINI") {
    this.clearTimer();
    this.phase = "ENDED";
    const roster = [...this.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role }));
    this.io.to(this.code).emit("game:ended", { winner, roster });
    this.broadcastLobbyState();
  }

  private forceEliminate(targetId: string, reason: string) {
    const p = this.players.get(targetId);
    if (!p) return;
    if (this.phase === "LOBBY") { this.removePlayer(targetId); return; }
    p.alive = false;
    p.killedBy = reason === "kick_host" ? "Espulso dall'host" : "Espulso dal gruppo (votekick)";
    this.io.to(targetId).emit("kicked", { reason: p.killedBy });
    this.pushGhostState();
    this.broadcastLobbyState();
    if (this.checkWinCondition()) return;
  }

  // --------------------------------------------------------------------
  // CHAT
  // --------------------------------------------------------------------

  handleChat(senderId: string, text: string) {
    const p = this.players.get(senderId);
    if (!p) return;
    const clean = text.slice(0, 300).trim();
    if (!clean) return;

    if (!p.alive) {
      // Ghost chat: SOLO gli altri morti la vedono.
      const msg: ChatMessage = { from: p.name, text: clean, ts: Date.now(), channel: "GHOST" };
      for (const other of this.players.values()) {
        if (!other.alive) this.io.to(other.id).emit("chat:message", msg);
      }
      return;
    }

    if (this.phase !== "DISCUSSION" && this.phase !== "MORNING") return; // chat viva solo in queste fasi
    const msg: ChatMessage = { from: p.name, text: clean, ts: Date.now(), channel: "LIVING" };
    for (const other of this.players.values()) {
      if (other.alive) this.io.to(other.id).emit("chat:message", msg);
    }
    this.forwardToGhosts(msg); // i morti vedono il 100% dei dati, chat viva inclusa
  }

  handleMafiaChat(senderId: string, text: string) {
    const p = this.players.get(senderId);
    if (!p || p.role !== "ASSASSINO" || !p.alive || this.phase !== "NIGHT") return;
    const clean = text.slice(0, 300).trim();
    if (!clean) return;
    const msg: ChatMessage = { from: p.name, text: clean, ts: Date.now(), channel: "MAFIA" };
    for (const a of this.livingAssassins()) this.io.to(a.id).emit("chat:message", msg);
    this.forwardToGhosts(msg); // i morti vedono anche la chat privata degli assassini
  }

  /** Inoltra in sola lettura un messaggio (chat viva o mafia) a tutti i morti. */
  private forwardToGhosts(msg: ChatMessage) {
    for (const p of this.players.values()) {
      if (!p.alive) this.io.to(p.id).emit("chat:message", msg);
    }
  }

  /**
   * Vista OMNISCIENTE per i morti: 100% dei dati della partita, non solo i
   * ruoli. Include oggetti disponibili/scelti di ognuno, chi ha votato cosa
   * di giorno, e le bozze/conferme di kill notturna degli assassini.
   */
  private pushGhostState() {
    const players = [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: p.role,
      itemOptions: p.itemOptions,
      chosenItemId: p.chosenItemId,
    }));

    const dayVotes = [...this.dayVotes.entries()].map(([voterId, choice]) => ({
      voterName: this.players.get(voterId)?.name ?? "?",
      choiceName: choice === "SKIP" ? "SALTA" : (this.players.get(choice)?.name ?? "?"),
    }));

    const nightVotes = [...this.nightKillVotes.entries()].map(([assassinId, targetId]) => ({
      assassinName: this.players.get(assassinId)?.name ?? "?",
      targetName: this.players.get(targetId)?.name ?? "?",
      confirmed: this.nightKillConfirmed.has(assassinId),
    }));

    const payload = { dayNumber: this.dayNumber, phase: this.phase, players, dayVotes, nightVotes };
    for (const p of this.players.values()) {
      if (!p.alive) this.io.to(p.id).emit("ghost:fullState", payload);
    }
  }

  // --------------------------------------------------------------------
  // BROADCAST HELPERS
  // --------------------------------------------------------------------

  broadcastLobbyState() {
    const state = {
      code: this.code,
      settings: this.settings,
      phase: this.phase,
      dayNumber: this.dayNumber,
      phaseEndsAt: this.phaseEndsAt,
      players: [...this.players.values()].map(p => ({ ...p.toPublicState(), disconnected: p.disconnected })),
    };
    this.io.to(this.code).emit("lobby:state", state);
  }

  /** Invia a OGNI giocatore SOLO il proprio stato segreto (mai quello altrui). */
  pushSecretStates() {
    for (const p of this.players.values()) {
      this.io.to(p.id).emit("me:secretState", p.toMySecretState());
    }
    this.pushGhostState();
  }

  isEmpty(): boolean {
    return [...this.players.values()].every(p => p.disconnected) || this.players.size === 0;
  }
}
