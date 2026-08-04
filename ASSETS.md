# Asset da fornire (placeholder attualmente generati via codice)

Il gioco funziona già interamente senza asset esterni (geometria Three.js
procedurale + canvas per i nomi). Quando avrai i tuoi asset, mettili qui e
collega i file indicati:

## Modelli 3D (opzionali, sostituiscono le geometrie placeholder)
Percorso: `public/assets/models/`
- `hazmat_suit.glb` — modello del giocatore in tuta hazmat + casco.
  Da caricare in `public/js/scene.js` con `GLTFLoader` al posto del
  gruppo Capsule+Sphere in `buildSeats()`.
- `bunker_room.glb` — ambientazione completa del bunker (se preferisci un
  modello fatto a mano invece dei cilindri proceduarali in `buildBunker()`).
- `round_table.glb` — tavolo circolare (sostituisce `buildTable()`).

## Texture
Percorso: `public/assets/textures/`
- `floor_concrete.jpg`, `wall_metal.jpg`, `ceiling_dark.jpg` — da applicare
  come `THREE.TextureLoader().load(...)` sui materiali in `buildBunker()`.

## Icone oggetti (mattina — scelta oggetti)
Percorso: `public/assets/items/` — un file per ogni voce di `ITEM_POOL` in
`src/ItemPool.ts` (i nomi file sono già previsti nel campo `icon`):
- `item_water.png`, `item_can.png`, `item_medkit.png`, `item_flashlight.png`,
  `item_gasmask.png`, `item_radio.png`, `item_steel_plate.png`, `item_blanket.png`,
  `item_batteries.png`, `item_map.png`, `item_rope.png`, `item_pills.png`,
  `item_backpack.png`, `item_compass.png`, `item_thermos.png`, `item_matches.png`,
  `item_sleeping_bag.png`, `item_sewing_kit.png`, `item_book.png`, `item_cards.png`,
  `item_gloves.png`, `item_water_filter.png`, `item_tent.png`, `item_boots.png`,
  `item_toolkit.png`, `item_seeds.png`

Dimensione consigliata: 128x128px, sfondo trasparente. Da collegare in
`public/js/ui.js` dentro `makeItemCard()` (sostituendo `.icon-placeholder`
con un `<img src="/assets/items/${icon}">`).

## Suoni (non ancora agganciati, opzionali)
Percorso: `public/assets/sfx/`
- `night_ambience.mp3` — loop durante la fase NOTTE.
- `vote_tick.mp3` — click quando si vota.
- `elimination_sting.mp3` — stinger quando qualcuno viene espulso/ucciso.
- `reveal_chime.mp3` — alla fase REVEAL.

## Font (opzionale)
Se vuoi un font a tema invece del sans-serif di sistema, aggiungi il file in
`public/assets/fonts/` e referenzialo con `@font-face` in `style.css`.
