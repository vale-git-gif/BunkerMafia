// ============================================================================
// BUNKER MAFIA - Tipi condivisi lato server
// Il client NON possiede questo file: riceve solo i dati filtrati per lui.
// ============================================================================

export type Role = "INNOCENTE" | "INVESTIGATORE" | "ASSASSINO";

export type GamePhase =
  | "LOBBY"        // in attesa nella lobby
  | "NIGHT"        // fase notturna, kill assassino/i
  | "MORNING"      // scelta oggetti
  | "DISCUSSION"   // chat + voto + spia investigatore
  | "REVEAL"       // rivelazione oggetti scelti (anonimo)
  | "ENDED";       // partita conclusa

export interface ItemDef {
  id: string;
  name: string;
  icon: string; // nome file placeholder, es: "item_water.png"
}

export interface PlayerPublicState {
  id: string;
  name: string;
  alive: boolean;
  isHost: boolean;
  // NON include mai: role, itemOptions, chosenItem di ALTRI giocatori
}

export interface LobbySettings {
  isPrivate: boolean;
  maxPlayers: number;      // <= 12
  numAssassins: 1 | 2 | 3;
  hasInvestigator: boolean;
}

export interface LobbySummary {
  code: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  isPrivate: boolean;
  phase: GamePhase;
}

// Vista dati personali che il server invia SOLO al proprietario
export interface MySecretState {
  role: Role | null;
  itemOptions: ItemDef[];  // 3 opzioni (vuoto se assassino, vuoto se morto/già scelto)
  chosenItemId: string | null;
  killedBy: string | null;        // nome di chi ti ha ucciso (solo se sei morto)
  investigatorLocked: boolean;    // true se l'investigatore ha già chiuso il potere oggi
}

// Vista OMNISCIENTE inviata SOLO ai giocatori morti (Ghost Chat): 100% dei dati.
export interface GhostOmniscientState {
  dayNumber: number;
  phase: GamePhase;
  players: Array<{
    id: string;
    name: string;
    alive: boolean;
    role: Role | null;
    itemOptions: ItemDef[];
    chosenItemId: string | null;
  }>;
  dayVotes: Array<{ voterName: string; choiceName: string }>;
  nightVotes: Array<{ assassinName: string; targetName: string; confirmed: boolean }>;
}

export interface RevealEntry {
  itemId: string;
  itemName: string;
  count: number; // quante persone hanno scelto quell'oggetto quella mattina
}

export interface ChatMessage {
  from: string;
  text: string;
  ts: number;
  channel: "LIVING" | "GHOST" | "MAFIA";
}

export interface VoteTally {
  [targetIdOrSkip: string]: number; // "SKIP" oppure playerId
}
