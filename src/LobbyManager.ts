import { Server } from "socket.io";
import { customAlphabet } from "nanoid";
import { Game } from "./Game";
import { LobbySettings, LobbySummary } from "./types";

const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6); // esclude 0/O/1/I ambigui

export class LobbyManager {
  private games: Map<string, Game> = new Map();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
    // Pulizia periodica delle lobby vuote/abbandonate
    setInterval(() => this.sweep(), 60_000);
  }

  createLobby(settings: LobbySettings): Game {
    let code = nanoid();
    while (this.games.has(code)) code = nanoid();
    const finalSettings: LobbySettings = {
      isPrivate: !!settings.isPrivate,
      maxPlayers: Math.max(4, Math.min(12, settings.maxPlayers || 8)),
      numAssassins: ([1, 2, 3].includes(settings.numAssassins) ? settings.numAssassins : 1) as 1 | 2 | 3,
      hasInvestigator: !!settings.hasInvestigator,
    };
    const game = new Game(code, finalSettings, this.io);
    this.games.set(code, game);
    return game;
  }

  get(code: string): Game | undefined {
    return this.games.get(code.toUpperCase());
  }

  listPublic(): LobbySummary[] {
    return [...this.games.values()]
      .filter(g => !g.settings.isPrivate && g.phase === "LOBBY")
      .map(g => ({
        code: g.code,
        hostName: [...g.players.values()].find(p => p.isHost)?.name ?? "?",
        playerCount: g.players.size,
        maxPlayers: g.settings.maxPlayers,
        isPrivate: g.settings.isPrivate,
        phase: g.phase,
      }));
  }

  private sweep() {
    for (const [code, game] of this.games.entries()) {
      if (game.isEmpty()) this.games.delete(code);
    }
  }

  remove(code: string) {
    this.games.delete(code);
  }
}
