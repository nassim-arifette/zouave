# Zouave · Paris DevDay Community Hackathon

**Track:** Impact → Climate action (adaptation to river floods).
**One line:** Zouave shows any Parisian, in 90 seconds and with official data only, what a 1910-type flood would do
to their street, and what to do about it — guided by the stone soldier Parisians already use to gauge the Seine.

## The 2-minute pitch video (due Sunday 25 October, before midnight Paris time)

Record the screen in Chrome at 1440×900 or larger, sound on. Start from a fresh tab on `http://localhost:3000`.
Press **D** (or the *Watch the story* button) at 0:15: the Story mode drives the product for about 90 seconds
while the Zouave narrates. Talk over the first and last 15 seconds only.

| Time | On screen | What you say |
| --- | --- | --- |
| 0:00 – 0:15 | Landing page, the Zouave in the middle of Paris | "In 1910 the Seine rose 8.62 m in Paris. If it happened today, the OECD estimates up to 5 million people affected and up to €30 billion in damage. Most Parisians have no idea what it would mean for their own street." |
| 0:15 – 1:45 | Press **D**: the Story mode runs (hook card → the Seine rises from today's live level to 1910 → buildings counter and official thresholds → the Zouave gets wet up to his shoulders → fly to the address → the water climbs the street photo → the 3 right moves) | Let the Zouave speak. Only add one line if there is a silence: "Everything you see is real open data: the PPRI flood plan, IGN buildings, Hub'Eau live gauge." |
| 1:45 – 2:00 | End card, then type a question to show the tool trace | "Under the hood: an OpenAI Realtime voice agent that can only answer through function calls on official data — you see every call. Zouave. See your flood before it comes." |

Backup: if anything stalls during recording, press **Esc**, reload, and press **D** again. Keep the best take.

## How we use OpenAI

- **Realtime voice agent** (`gpt-realtime-2.1`, or the Live API with `gpt-live-1` and Responses delegation): the Zouave
  persona talks with the visitor and calls seven browser-side tools (`afficher_scenario`, `afficher_crue`, `aller_a`,
  `exposition`, `niveau_seine`, `photo_inondee`, `consignes`). The system prompt forbids any number that does not come
  from a tool result.
- **Tool trace**: every call (voice or typed) is shown under the answer — function, arguments, official figure and source.
  This is how we check quality: the answer can only repeat what a tool returned.
- **OpenAI Images (edits)**: the flooded versions of the demo street photos were generated from Panoramax pictures and
  are labelled *Estimated*; the live 3D street scene uses a depth map (Depth Anything V2 Small) instead.
- **Without a key**, the demo still runs: the browser's speech synthesis gives the Zouave a voice and typed intents
  call the same tools.

## What is real, what is estimated, what is simulated

| Real (measured or official) | Estimated (our computation, labelled) | Simulated (illustration) |
| --- | --- | --- |
| Live Seine level at Austerlitz (Hub'Eau / Vigicrues) | Depth bands for other historic levels (PPRI classes shifted by the gauge difference) | Water rising on the street photo |
| 1910 level 8.62 m and the PPRI 1910 flood map (DRIEAT) | Under 50 cm in the SDRIF-E extreme footprint | Flooded street photos (OpenAI edits) |
| IGN BD TOPO buildings, 1910 flooded cellars (City of Paris) | Buildings counted inside the footprint (mapped area only) | |
| Official safety instructions (City of Paris, Géorisques, Prefecture) | | |

## Likely questions

- **Who is it for?** A Parisian renting a ground-floor flat in the 12th: they do not read PPRI maps, but they will ask the Zouave.
- **Who pays?** Cities and prefectures for risk awareness campaigns (a legal duty to inform residents in flood zones),
  insurers and landlords for tenant information.
- **Why a voice agent?** People ask natural questions ("will my cellar flood?"); the agent turns them into tool calls on
  official layers, and the trace keeps it honest.
- **Next steps:** every French city with a PPRI (same open data), a phone-first version, alerts when Vigicrues rises.
- **Limits:** educational scenarios, not forecasts or building surveys; the extreme scenario has no published local depths.

## Submission checklist

- [ ] 2-minute video uploaded via the organisers' form (email + Luma), before midnight Paris time
- [ ] GitHub repo link (and project link if deployed)
- [ ] Post progress with @borvibe @openaidevs #parisdevdayhack (Build in public track)
