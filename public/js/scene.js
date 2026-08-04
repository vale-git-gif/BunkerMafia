// ============================================================================
// scene.js — Scena 3D low-poly del bunker in prima persona.
// Asset richiesti (placeholder qui, sostituiscili tu — vedi ASSETS.md):
//   - nessun asset esterno obbligatorio: tutto è geometria procedurale.
//   - se vuoi textures: metti i file in public/assets/textures/ e caricali
//     con THREE.TextureLoader qui dentro.
// ============================================================================
import * as THREE from "three";

let renderer, scene, camera;
let playerSlots = [];      // { group, nameSprite } per ogni posto al tavolo
const MAX_SEATS = 12;
const EYE_HEIGHT = 1.58;   // altezza occhi, in linea col casco del modello hazmat

let targetYaw = 0, targetPitch = 0;
let currentYaw = 0, currentPitch = 0;
let baseYaw = 0, basePitch = 0;   // orientamento "di riposo" verso il centro del tavolo, dal posto occupato
let localSeatIndex = -1;

export function initScene(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05070a);

  // Da three.js r155+ l'illuminazione usa di default unità fotometriche
  // "fisicamente corrette": le stesse intensità di luce (pensate per il
  // vecchio sistema) risultano MOLTO più deboli, rendendo la scena quasi
  // nera (si vedono solo le lucine emissive, che non dipendono da alcuna
  // luce). Ripristiniamo il comportamento "classico" così le intensità
  // sotto restano visivamente corrette, e aggiungiamo tone mapping/exposure
  // espliciti per un'immagine luminosa ma con atmosfera scura.
  if ("useLegacyLights" in renderer) renderer.useLegacyLights = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05070a, 5, 18);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.rotation.order = "YXZ";
  camera.position.set(0, EYE_HEIGHT, 3.1); // punto di partenza, verrà riposizionato sul proprio posto

  buildBunker();
  buildTable();
  buildSeats();

  window.addEventListener("resize", onResize);
  requestAnimationFrame(loop);
}

function buildBunker() {
  // Pavimento (leggermente più chiaro del nero puro: con luci deboli un
  // materiale quasi-nero non riflette nulla e resta invisibile)
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 0.2, 16),
    new THREE.MeshStandardMaterial({ color: 0x2b333b, roughness: 0.9, metalness: 0.05 })
  );
  floor.position.y = -0.1;
  scene.add(floor);

  // Parete circolare bassa poligonale (bunker)
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 3.2, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1c232b, roughness: 0.95, side: THREE.BackSide })
  );
  wall.position.y = 1.5;
  scene.add(wall);

  // Soffitto
  const ceiling = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 0.2, 16),
    new THREE.MeshStandardMaterial({ color: 0x161c21, roughness: 1 })
  );
  ceiling.position.y = 3.1;
  scene.add(ceiling);

  // Luce ambientale fredda (illumina uniformemente anche le facce in ombra)
  scene.add(new THREE.AmbientLight(0x445866, 1.1));

  // Hemisphere light: aggiunge una componente cielo/pavimento morbida che
  // da sola evita che qualunque superficie risulti completamente nera.
  const hemi = new THREE.HemisphereLight(0x8fb8d8, 0x14181c, 0.8);
  scene.add(hemi);

  // Debole luce direzionale dall'alto: dà un minimo di volume/ombreggiatura
  // ai modelli senza "appiattire" l'atmosfera cupa del bunker.
  const dir = new THREE.DirectionalLight(0xcfe0ee, 0.35);
  dir.position.set(2, 5, 3);
  scene.add(dir);

  // Lucette fredde appese sopra il tavolo (punti luce)
  const lightPositions = [
    [0, 2.6, 0], [2.5, 2.3, 2.5], [-2.5, 2.3, -2.5], [2.5, 2.3, -2.5], [-2.5, 2.3, 2.5],
  ];
  for (const [x, y, z] of lightPositions) {
    const l = new THREE.PointLight(0x9fd8ff, 1.6, 9, 2);
    l.position.set(x, y, z);
    scene.add(l);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xcfeeff })
    );
    bulb.position.set(x, y, z);
    scene.add(bulb);
  }
}

function buildTable() {
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 0.12, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a2b1e, roughness: 0.8 })
  );
  table.position.y = 0.75;
  scene.add(table);

  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.75, 8),
    new THREE.MeshStandardMaterial({ color: 0x241a12 })
  );
  leg.position.y = 0.375;
  scene.add(leg);
}

function buildSeats() {
  // Predispone MAX_SEATS "slot" attorno al tavolo; verranno popolati/svuotati
  // dinamicamente da updatePlayers() in base a chi è realmente in lobby.
  const radius = 2.15;
  for (let i = 0; i < MAX_SEATS; i++) {
    const angle = (i / MAX_SEATS) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.lookAt(0, 0.9, 0);
    group.visible = false;

    // Corpo hazmat placeholder (basso poly)
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.55, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8c93a, roughness: 0.6 })
    );
    body.position.y = 0.95;
    group.add(body);

    // Casco anonimo
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.3, metalness: 0.2 })
    );
    helmet.position.y = 1.55;
    group.add(helmet);

    // Visiera scura
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x05080a, roughness: 0.1 })
    );
    visor.position.set(0, 1.55, 0.16);
    group.add(visor);

    // Sprite nome + triangolino indicatore (canvas texture generata al volo)
    const nameSprite = makeNameSprite("");
    nameSprite.position.set(0, 2.05, 0);
    group.add(nameSprite);

    scene.add(group);
    playerSlots.push({ group, nameSprite, body });
  }
}

function makeNameSprite(text) {
  const canvasEl = document.createElement("canvas");
  canvasEl.width = 256; canvasEl.height = 96;
  const ctx = canvasEl.getContext("2d");
  drawNameCanvas(ctx, text);
  const texture = new THREE.CanvasTexture(canvasEl);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.9, 0.34, 1);
  sprite.userData.canvas = canvasEl;
  sprite.userData.ctx = ctx;
  sprite.userData.texture = texture;
  return sprite;
}

function drawNameCanvas(ctx, text) {
  ctx.clearRect(0, 0, 256, 96);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 128, 40);
  // triangolino sotto che punta verso il giocatore
  ctx.beginPath();
  ctx.moveTo(128, 70);
  ctx.lineTo(118, 55);
  ctx.lineTo(138, 55);
  ctx.closePath();
  ctx.fill();
}

/**
 * Aggiorna quali posti sono occupati e con quale nome (dati pubblici SOLO).
 * myId identifica il TUO posto: il tuo stesso modello va nascosto (sei in
 * prima persona, non devi vedere la tua testa/corpo) e la camera va agganciata
 * esattamente a quel posto, ad altezza occhi.
 */
export function updatePlayers(players, myId) {
  localSeatIndex = players.findIndex(p => p.id === myId);

  for (let i = 0; i < playerSlots.length; i++) {
    const slot = playerSlots[i];
    const p = players[i];
    if (!p) { slot.group.visible = false; continue; }

    const isLocal = i === localSeatIndex;
    slot.group.visible = !isLocal; // nascondi il proprio avatar: sei in prima persona
    if (!isLocal) {
      drawNameCanvas(slot.nameSprite.userData.ctx, p.name + (p.alive === false ? " (morto)" : ""));
      slot.nameSprite.userData.texture.needsUpdate = true;
      slot.body.material.color.set(p.alive === false ? 0x555b60 : 0xd8c93a);
    }
  }

  if (localSeatIndex >= 0) positionCameraAtSeat(localSeatIndex);
}

function positionCameraAtSeat(index) {
  const seat = playerSlots[index].group;
  camera.position.set(seat.position.x, EYE_HEIGHT, seat.position.z);

  // IMPORTANTE: Object3D.lookAt() orienta un oggetto generico secondo la
  // convenzione "+Z verso il target", mentre Camera/Light usano "-Z verso il
  // target" (è così anche internamente in three.js). Usare un Object3D
  // temporaneo per calcolare l'orientamento "di riposo" produceva quindi una
  // rotazione ESATTAMENTE invertita di 180° una volta applicata alla camera
  // reale (si vedeva il muro dietro invece del tavolo). Chiamando lookAt
  // DIRETTAMENTE sulla camera si usa la convenzione corretta.
  camera.lookAt(0, 1.5, 0);
  baseYaw = camera.rotation.y;
  basePitch = camera.rotation.x;
}

/** Chiamato dal modulo UI in base alla posizione del mouse (solo zona 2/3 superiore). */
export function setLookTarget(normX, normY) {
  targetYaw = (normX - 0.5) * 1.1;    // rad, range approx [-0.55, 0.55]
  targetPitch = (normY - 0.5) * 0.5;  // guarda leggermente su/giù
}

function loop() {
  requestAnimationFrame(loop);
  currentYaw += (targetYaw - currentYaw) * 0.06;
  currentPitch += (targetPitch - currentPitch) * 0.06;
  camera.rotation.y = baseYaw - currentYaw;
  camera.rotation.x = basePitch - currentPitch;
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
