// ============================================================================
// main.js — Boot dell'app: prima si sceglie la modalità (Mouse/Desktop 3D
// oppure Touch/Tablet a schermo intero), POI si avvia la scena 3D (solo se
// serve) e la UI. Backend e logica di gioco restano identici in entrambi i
// casi: cambia solo cosa viene renderizzato lato client.
// ============================================================================
import * as Net from "./network.js";
import "./ui.js";

const modeScreen = document.getElementById("mode-select-screen");
const menuScreen = document.getElementById("menu-screen");

document.getElementById("btn-mode-desktop").addEventListener("click", () => chooseMode("desktop"));
document.getElementById("btn-mode-touch").addEventListener("click", () => chooseMode("touch"));

async function chooseMode(mode) {
  document.body.classList.add(mode === "touch" ? "touch-mode" : "desktop-mode");
  window.__uiMode = mode;
  modeScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");

  if (mode === "desktop") {
    // La scena 3D viene inizializzata SOLO in modalità desktop: niente WebGL
    // superfluo su dispositivi touch a bassa potenza.
    const { initScene, updatePlayers } = await import("./scene.js");
    initScene(document.getElementById("scene-canvas"));
    Net.on("lobby:state", (lobby) => updatePlayers(lobby.players, Net.state.myId));
  }
}
