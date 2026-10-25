# Zouave avatar pipeline

Generates the voice-panel avatar of the Zouave statue (Pont de l'Alma) with the OpenAI Images API,
using Wikimedia Commons photos of the real statue as references.

Requirements: Node 20+ (no npm deps), Python 3 with `pillow numpy opencv-python-headless "rembg[cpu]"`,
`OPENAI_API_KEY` in the environment.

```sh
node scripts/avatar/generate_openai.mjs            # out/option{1..4}.png (+ .json with prompt/usage)
python3 scripts/avatar/contact_sheet.py            # out/contact_sheet.png, numbered 1-4
node scripts/avatar/mouth_masks.mjs                # out/option{N}_mouthmask.png from MOUTH_BOXES
node scripts/avatar/speaking_openai.mjs --options 1,2,4   # out/option{N}_speaking_raw.png (masked edit)
python3 scripts/avatar/finalize.py                 # web/public/zouave/<variant>/...
```

Prompts, reference photos (with licences) and mouth boxes live in `prompts.mjs`; the kept variants and the
default one are set in `VARIANTS` / `DEFAULT` at the top of `finalize.py`.

Output per variant in `web/public/zouave/<variant>/`: `avatar.png` (512, transparent), `avatar@2x.png`
(1024), `avatar-speaking.png` / `@2x` (mouth open, pixel-aligned with the idle frame), `.webp` copies of
each, `favicon.svg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png`. The files at the root of `web/public/zouave/` mirror the default variant;
`variants.json` lists all variants. Open `web/public/zouave/preview.html` through any static server to
try the 2-frame talk animation and the listening "breathe" state.
