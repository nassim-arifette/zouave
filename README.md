# Zouave

A French-language flood-awareness demo: explore Paris in 3D, compare a 1910-type
flood with an extreme footprint, locate an address and read official precautions.
Scenarios are educational, not forecasts or building-level diagnoses.

## Run

Requires Node >=22.6 and npm. On this VM, first run
`export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.

```sh
npm ci
npm run dev       # Vite on 5173, Express on 3000, /api proxy
npm start         # Type-check + build, then one server on :3000
npm test          # Isolated HTTP/unit tests; no OpenAI requests
```

Environment variables (optional gitignored `.env`, see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Enables voice; never sent to the browser |
| `ZOUAVE_VOICE` | `live` | `live` or `realtime` |
| `ZOUAVE_REALTIME_MODEL` | `gpt-realtime-2.1` | Set `gpt-realtime` if the newer model is unavailable |
| `PORT` | `3000` | Production/Express port; dev proxy targets 3000 |

Without a key, every map, address, exposure and safety feature works via the four
demo buttons, text input and shortcuts **1–4**. The Zouave still talks without a key: the browser reads his
answers aloud (Web Speech synthesis, fr-FR, mutable with the speaker button) and, where the
browser supports speech recognition, the mic turns a spoken sentence into a text intent.
Press **H** (or the *Immersion* button) to hide the panels and let the camera drift over the city. The demo address is configured in
`web/src/config.ts`: **4 Rue Traversière, 75012 Paris**. Enter another full address
in the text input to locate it. Photo assets are supplied by a separate branch;
missing assets return an explicit 404 and do not interrupt the demo.

## Architecture

- `server/api.ts`: cached Hub'Eau and IGN proxies, offline fallback, optional photo
  manifest lookup, and SDK Live / multipart Realtime WebRTC session negotiation.
- `server/tools.ts`: French persona and strict browser-function schemas. Neither
  voice prompt may invent numbers; facts must come from tool results.
- `web/src/tools.ts`: the same six tool implementations for voice and local intents;
  Turf checks the delivered WGS84 polygons. Every card carries attribution.
- `web/src/map.ts`: local Protomaps PMTiles, IGN building extrusions and flood layers.
- `web/src/water.ts`: Three.js custom MapLibre layer sharing its WebGL2 context.
  PPRI polygon meshes preserve holes and class depths; a murky Seine-flood shader
  animates flow-driven ripples, sky Fresnel and sun glint, darkens with class depth,
  and adds foam along banks and building walls (a blurred mask of the PPRI polygons
  minus IGN footprints) during the four-second rise.
  Set `waterRenderer: 'extrusion'` in config for the simpler class-colored fallback.
  The visual depth exaggeration defaults to 2; labels always use official intervals.
- `web/src/hero.ts`: street-level "hero" scene. The Panoramax photo of the address is
  unprojected into a 2.5D relief with a precomputed depth map (`scripts/photo/depth.py`),
  and real-time Three.js water (planar reflection, screen-space refraction, silt
  absorption, wet band on walls, foam, debris) rises to the requested height; a slider
  lets the user scrub 0–3 m. Falls back to the AI-edited photo when no depth map exists.
- `web/src/speech.ts`: browser voice fallback (speech synthesis + recognition) for the Zouave.
- `web/src/immersion.ts`: intro fade-out on first interaction, *Immersion* mode (H) with a slow camera drift.
- `web/src/voice.ts`: microphone/WebRTC lifecycle, captions, Live nested Responses
  function results and Realtime function results. The mic stops and frees devices;
  idle sessions close after two minutes. Live uses graceful `session.close`.
- `web/public/data/consignes.json`: source-linked, family-tailored official advice.

Live uses `gpt-live-1`, Responses delegation to `gpt-6-luna`, tool execution in the
browser and `response.item.create` / `response.create` continuation. Realtime uses
`conversation.item.create` function results and `response.create`. Select Realtime
explicitly if the project's Live access is unavailable. No hidden billable retry.
Only click the mic when needed: sessions incur a minimum voice charge.

## Offline and data limitations

The basemap, glyphs, sprites, buildings, hazard polygons, safety data and demo
geocodes are local. Hub'Eau falls back to a dated snapshot marked stale; IGN falls
back only for bundled demo addresses after an upstream failure. Unknown addresses
never silently become the demo location. No offline voice or generated photos.

Read [`data/README.md`](data/README.md) for source URLs, licensing, precision and
reproduction. PPRI `2+` is open ended (`h_max:null`), displayed as **plus de 2 m**,
with a 3 m visual mesh. SDRIF-E has no published local depths and always stays flat.
The gauge values at Austerlitz are **not** depths at an address. Caves are exposure
sectors in a scenario, not evidence that a particular cellar flooded historically.

The avatar automatically uses `/zouave/avatar.png` and
`/zouave/avatar-speaking.png` when supplied, otherwise the bundled SVG placeholder.
Photo lookup accepts a slug-keyed object, array or `{photos: [...]}` of entries:
`{lat,lon,address_label,heights:{"1":"slug/1.jpg","2":"slug/2.jpg"},url_clean,credit,license}`.
Relative paths resolve beneath `/photos/`; the nearest available simulated height
is returned rather than relabeling an image with the requested height. Entries with
`files.depth` (see `scripts/photo/depth.py`) also return `url_depth` and `view`
(fov, pitch, camera height) so the browser renders the live 3D street scene instead.

## Verification

`npm run build` type-checks frontend/server and generates `web/dist`.
`npm test` covers API success, empty data, invalid input, offline behavior, caching,
absent photos, manifest selection, and session failure/negotiation with mocked upstream.
The browser verification and billable voice smoke scripts are documented alongside
their results in `data/APP_VERIFICATION.md`.
