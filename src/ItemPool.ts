import { ItemDef } from "./types";

// Pool di oggetti "sopravvivenza". Le icone sono placeholder: metti i tuoi
// file PNG/SVG in public/assets/items/<icon> (vedi ASSETS.md).
export const ITEM_POOL: ItemDef[] = [
  { id: "water", name: "Borraccia d'acqua", icon: "item_water.png" },
  { id: "canned_food", name: "Cibo in scatola", icon: "item_can.png" },
  { id: "medkit", name: "Kit di pronto soccorso", icon: "item_medkit.png" },
  { id: "flashlight", name: "Torcia", icon: "item_flashlight.png" },
  { id: "gasmask", name: "Maschera antigas", icon: "item_gasmask.png" },
  { id: "radio", name: "Radio ricetrasmittente", icon: "item_radio.png" },
  { id: "steel_plate", name: "Piastra di Acciaio", icon: "item_steel_plate.png" },
  { id: "blanket", name: "Coperta termica", icon: "item_blanket.png" },
  { id: "batteries", name: "Batterie", icon: "item_batteries.png" },
  { id: "map", name: "Mappa del bunker", icon: "item_map.png" },
  { id: "rope", name: "Corda", icon: "item_rope.png" },
  { id: "pills", name: "Antidolorifici", icon: "item_pills.png" },
  { id: "backpack", name: "Zaino da Sopravvivenza", icon: "item_backpack.png" },
  { id: "compass", name: "Bussola", icon: "item_compass.png" },
  { id: "thermos", name: "Thermos Termico", icon: "item_thermos.png" },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Estrae 3 oggetti distinti casuali dal pool. */
export function drawThreeItems(): ItemDef[] {
  return shuffle(ITEM_POOL).slice(0, 3);
}
