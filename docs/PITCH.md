# Zouave · Paris DevDay Community Hackathon

**Track:** Impact → Climate action (adapting to river floods).
**One line:** Zouave shows any Parisian, in 90 seconds and with official data only, what a 1910-type flood would do to
their street and what to do about it, voiced by the stone soldier Parisians already use to read the Seine.

**The number that hooks:** if 1910 happened today, up to 5 million people hit and up to €30 billion of damage
(OECD estimates). 1910 is the reference flood: 8.62 m at the Austerlitz gauge.

---

## 1. The 2-minute video (submission, before Sunday midnight Paris time)

Rendered with **HyperFrames** (HTML + GSAP → MP4) from real screenshots of the app (MapLibre and Google Photorealistic 3D
views, from `docs/google-compare/`) and the OpenAI image edits of the demo street, voiced by the Zouave
(**ElevenLabs** v3, "Jamie", French accent) with burned-in subtitles. Source: [`video/`](../video) ·
render: `cd video && npx hyperframes render -o zouave-pitch.mp4` (1 min 42 s). To rebuild from fresh screenshots:
`npm start`, then `node video/capture.mjs && python3 video/build.py`.

| Time | Scene | Voice-over (the Zouave) |
| --- | --- | --- |
| 0:00 | **Hook**: 8.62 m, 5 million, €30 billion, over the flooded city in Google 3D | "January 1910. The Seine rises to 8.62 metres in Paris. If it happened today: up to five million people hit. Up to thirty billion euros of damage. And most Parisians have no idea what it would mean for their street." |
| 0:18 | **Meet Zouave**: the Alma bridge under 1910 water, Google Photorealistic 3D | "Bonjour! I'm the Zouave, the stone soldier of the Alma bridge. For generations, Parisians have read the floods on my body. Now, I talk. Ask me about any address, and I show you your flood, with official data only." |
| 0:36 | **The Seine rises**: today → 2016 → 1910, then the same flood in Google 3D | "Watch. Here is the Seine today. Now it rises! 2016: the quays close, the trains stop. 1910: thousands of buildings in the flood zone. Up to my shoulders!" |
| 0:51 | **Your street**: the address in Google 3D (1 to 2 m), then the real street photo going from dry to 0.5 m to 1.5 m (OpenAI image edits, labelled Simulation / Estimated) | "And your home? Four, rue Traversière: one to two metres of water. This is your street. A simulation, not a forecast." |
| 1:06 | **The agent shows its work**: tool trace, official advice | "Talk to me, or type. Every answer shows the tools I called: the live gauge, the official flood map, the safety advice. I never invent a number." |
| 1:19 | **Under the hood**: OpenAI Realtime, open data, Google 3D + Three.js, ElevenLabs, OpenAI image edits | "Under the hood: an OpenAI Realtime voice agent with function calling, French open data, a Three.js city, and my French accent by ElevenLabs." |
| 1:31 | **Close** | "Zouave. See your flood… before it comes. À bientôt!" |

(If the real 1910 photographs are fetched, a "This is not a simulation: Bercy, January 1910" scene is inserted after
"Your street".)

---

## 2. The live pitch (finale, Monday 26 October, Hexa · 3 minutes)

One person talks, one drives the laptop. Never describe what is already on screen; say what the jury cannot see.

| Time | Driver does | Speaker says |
| --- | --- | --- |
| 0:00 – 0:20 | Landing page, Zouave in the middle of Paris | "In January 1910 the Seine rose 8.62 metres in Paris. The OECD says that if it happened today, up to five million people would be hit and the damage could reach thirty billion euros. And almost nobody knows what it would mean for their own street." |
| 0:20 – 0:35 | Point at the Zouave | "This is the Zouave of the Alma bridge: Parisians have measured floods on his body for generations. We gave him a voice. Zouave turns the official flood maps nobody reads into a two-minute conversation." |
| 0:35 – 1:50 | Press **D**: the Story runs (the Zouave narrates) | Stay silent while he talks. One line during the rise: "These counters are computed live from IGN buildings and the official 1910 flood map." |
| 1:50 – 2:20 | Press **Esc**, type "Will my cellar flood?" | "Now a real question. Look under the answer: every tool call is shown, the gauge, the flood map, the cellar sectors. The agent is an OpenAI Realtime model with function calling, and its rule is simple: no number unless a tool returned it." |
| 2:20 – 2:40 | Press **U** (Under the hood) | "The hard part: one number on a river gauge becomes a depth at your door. We shift the official 1910 depth classes by the gauge difference, and label every figure measured, official or estimated. It runs on French open data, and works offline for the demo." |
| 2:40 – 3:00 | End card with the QR code | "Next: every French city with a flood plan has the same open data. Cities have a duty to inform residents; Zouave does it in a conversation. Scan the code and check your own address. Zouave: see your flood before it comes." Then stop talking. |

**Transitions to memorise:** "almost nobody knows" → "we gave him a voice" → "now a real question" → "the hard part"
→ "scan the code".

**Keys:** D story · Space pause · → next step · Esc stop · U under the hood · H immersion · 1–4 demo questions.

---

## 3. How we use AI

- **OpenAI Realtime voice agent** (`gpt-realtime-2.1`, or the Live API with `gpt-live-1`): the Zouave persona talks
  with the visitor and calls seven browser-side tools (`afficher_scenario`, `afficher_crue`, `aller_a`,
  `exposition`, `niveau_seine`, `photo_inondee`, `consignes`). The system prompt forbids any number that does not come
  from a tool result.
- **Tool trace**: every call (voice or typed) is shown under the answer, with its arguments, the official figure and
  its source. That is how we check quality: the answer can only repeat what a tool returned.
- **ElevenLabs**: the Zouave's voice, English with a French accent ("Jamie"); `eleven_multilingual_v2` for answers
  (≈2 s), `eleven_v3` with emotion tags for the Story narration. Every line is cached on disk, so a rehearsed demo
  replays even if the venue's network fails; OpenAI text-to-speech and then the browser voice are fallbacks.
- **OpenAI Images (edits)**: the flooded versions of the demo street photos, labelled *Estimated*; the live street
  scene uses a depth map (Depth Anything V2 Small) and real-time Three.js water.
- **Without any key**, the demo still runs: typed questions call the same tools and the browser speaks.

## 4. What is real, estimated or simulated

| Real (measured or official) | Estimated (our computation, labelled) | Simulated (illustration) |
| --- | --- | --- |
| Live Seine level at Austerlitz (Hub'Eau / Vigicrues) | Depth bands for other historic levels (official classes shifted by the gauge difference) | Water rising on the street photo |
| 1910 level 8.62 m and the PPRI 1910 flood map (DRIEAT) | Under 50 cm in the SDRIF-E extreme footprint | Flooded street photos (OpenAI edits) |
| IGN BD TOPO buildings, 1910 flooded cellars (City of Paris) | Buildings counted inside the footprint (mapped area only) | The Zouave's voice (ElevenLabs) |
| Official safety instructions (City of Paris, Géorisques, Prefecture) | | |

## 5. Questions the jury will ask

- **Who is it for?** A Parisian renting a ground-floor flat in the 12th: they never read a PPRI map, but they will ask
  the Zouave a question.
- **Who pays?** Cities and prefectures (they must inform residents in flood zones, today with PDFs), insurers and
  landlords for tenant information.
- **Why a voice agent?** People ask natural questions ("will my cellar flood?"); the agent turns them into tool calls
  on official layers, and the trace keeps it honest.
- **What is real, what is simulated?** See the table above, and the badges in the app.
- **How do you measure quality?** No number without a tool result, visible in the trace; 100+ automated tests; the
  1910 depth classes are the official ones.
- **Next steps?** Every French city with a PPRI (same open data), phones first, alerts when Vigicrues rises.
- **Limits?** Educational scenarios, not forecasts or building surveys; the extreme scenario has no published local
  depths.

## 6. Live finale checklist

- [ ] `npm start` with `ELEVENLABS_API_KEY` (and `OPENAI_API_KEY` for the live voice agent) in `.env`
- [ ] Play the Story once before going on stage: every narrated line is cached
- [ ] Projector: Chrome at 125 % zoom; laptop plugged in, sleep disabled, notifications off
- [ ] `ZOUAVE_HTTPS=1 npm start` if the jury should use voice from their phones (QR code)
- [ ] Q&A crowd-pleaser: poke the Zouave on screen, or click a juror's street on the map → "What about here?"
- [ ] Backup: the submitted video, plus `npm run record-demo`
- [ ] Post with @borvibe @openaidevs #parisdevdayhack
