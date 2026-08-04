import express from "express";
import http from "http";
import path from "path";
import { Server, Socket } from "socket.io";
import { LobbyManager } from "./LobbyManager";
import { LobbySettings } from "./types";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // in produzione: restringi all'origine del tuo dominio
});

const lobbyManager = new LobbyManager(io);

function ack(cb: any, payload: any) {
  if (typeof cb === "function") cb(payload);
}

io.on("connection", (socket: Socket) => {
  // ---------------------------------------------------------------
  // SINCRONIZZAZIONE OROLOGIO: il client la usa SOLO per mostrare il
  // countdown in modo corretto; il server resta l'unica autorità sui tempi
  // di fase (phaseEndsAt calcolato e fatto scadere lato server).
  // ---------------------------------------------------------------
  socket.on("time:sync", (cb) => {
    if (typeof cb === "function") cb(Date.now());
  });

  // -----------------------------------------------------------------
  // LISTA LOBBY PUBBLICHE
  // -----------------------------------------------------------------
  socket.on("lobby:list", (cb) => {
    ack(cb, { ok: true, lobbies: lobbyManager.listPublic() });
  });

  // -----------------------------------------------------------------
  // CREAZIONE LOBBY
  // -----------------------------------------------------------------
  socket.on("lobby:create", (data: { playerName: string; settings: LobbySettings }, cb) => {
    if (!data?.playerName || data.playerName.trim().length === 0) {
      return ack(cb, { ok: false, error: "Nome richiesto." });
    }
    const game = lobbyManager.createLobby(data.settings);
    const res = game.addPlayer(socket.id, data.playerName.trim());
    if (!res.ok) return ack(cb, res);

    socket.data.lobbyCode = game.code;
    socket.join(game.code);
    ack(cb, { ok: true, code: game.code });
    game.broadcastLobbyState();
    game.pushSecretStates();
  });

  // -----------------------------------------------------------------
  // JOIN LOBBY (per codice o dalla lista pubblica)
  // -----------------------------------------------------------------
  socket.on("lobby:join", (data: { code: string; playerName: string }, cb) => {
    const game = lobbyManager.get((data?.code || "").trim());
    if (!game) return ack(cb, { ok: false, error: "Lobby non trovata." });
    if (!data?.playerName || data.playerName.trim().length === 0) {
      return ack(cb, { ok: false, error: "Nome richiesto." });
    }
    const res = game.addPlayer(socket.id, data.playerName.trim());
    if (!res.ok) return ack(cb, res);

    socket.data.lobbyCode = game.code;
    socket.join(game.code);
    ack(cb, { ok: true, code: game.code });
    game.broadcastLobbyState();
    game.pushSecretStates();
  });

  function currentGame() {
    const code = socket.data.lobbyCode;
    if (!code) return null;
    return lobbyManager.get(code) ?? null;
  }

  // -----------------------------------------------------------------
  // HOST ACTIONS
  // -----------------------------------------------------------------
  socket.on("lobby:updateSettings", (settings: Partial<LobbySettings>) => {
    currentGame()?.updateSettings(socket.id, settings);
  });

  socket.on("lobby:start", (cb) => {
    const game = currentGame();
    if (!game) return ack(cb, { ok: false, error: "Non sei in una lobby." });
    const res = game.startGame(socket.id);
    ack(cb, res);
  });

  socket.on("lobby:kick", (targetId: string) => {
    currentGame()?.kickPlayer(socket.id, targetId);
  });

  // -----------------------------------------------------------------
  // GAMEPLAY ACTIONS - tutte validate server-side dentro Game.ts
  // -----------------------------------------------------------------
  socket.on("game:nightKill", (targetId: string) => {
    currentGame()?.submitNightKillVote(socket.id, targetId);
  });

  socket.on("game:nightKillConfirm", () => {
    currentGame()?.confirmNightKill(socket.id);
  });

  socket.on("game:chooseItem", (itemId: string) => {
    currentGame()?.chooseItem(socket.id, itemId);
  });

  socket.on("game:investigatorSpy", (targetId: string) => {
    currentGame()?.investigatorSpy(socket.id, targetId);
  });

  socket.on("game:investigatorClose", () => {
    currentGame()?.closeInvestigation(socket.id);
  });

  socket.on("game:vote", (targetIdOrSkip: string) => {
    currentGame()?.castVote(socket.id, targetIdOrSkip);
  });

  socket.on("chat:send", (text: string) => {
    currentGame()?.handleChat(socket.id, text);
  });

  socket.on("chat:mafiaSend", (text: string) => {
    currentGame()?.handleMafiaChat(socket.id, text);
  });

  // -----------------------------------------------------------------
  // DISCONNESSIONE
  // -----------------------------------------------------------------
  socket.on("disconnect", () => {
    const game = currentGame();
    if (game) {
      game.removePlayer(socket.id);
      if (game.isEmpty()) lobbyManager.remove(game.code);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bunker Mafia server in ascolto su:`);
  console.log(`  - locale:  http://localhost:${PORT}`);
  console.log(`  - rete/LAN e Internet: http://<indirizzo-ip-o-dominio-del-server>:${PORT}`);
});
