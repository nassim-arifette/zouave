# Assets ledger

| Path | What | Source / licence |
| --- | --- | --- |
| `zouave/s1..s8_*.mp4` | The Zouave speaking, 1080x1080, 25 fps, AAC voice embedded (8 segments, ~104 s) | Avatar `web/public/zouave/living-stone/avatar@2x.png` animated with Ditto-TalkingHead (Ant Group, Apache-2.0) on a Modal A10G; voice OpenAI TTS `gpt-4o-mini-tts`, voice `verse`, English with a light French accent (`scripts/tts_segments.mjs`). |
| `site/a_1910.mp4` … `site/e_safety.mp4` | Screen captures of the real site at 1920x1080 (home + "Show me 1910", "What about my home?", street scene, time slider, "What should I do?") | Recorded with `scripts/record_site.mjs` (Playwright over CDP, Page.startScreencast) against `npm start` on localhost:3000, then motion-interpolated to 30 fps with FFmpeg `minterpolate`. Gitignored (45 MB); re-record with the script. |
| `stills/paris_1910.jpg`, `stills/home.jpg` | Frames from the site captures used as backdrops | Same as above. |
| `stills/avatar.png` | Original avatar | Repo asset. |
| `script.json` | The eight narrated segments (English). Figures: 8.62 m (1910, Austerlitz), OECD, Institut Paris Région, +80 % (2016-type rains), Inès / 4 rue Traversière (PPRI 1–2 m, cellar flooded in 1910). | Written for this film; no other figures used. |

Street photo inside the captures: Panoramax, CC BY-SA 4.0 (credited on the end card). No music.
