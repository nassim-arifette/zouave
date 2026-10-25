# Street photo workflow

Run `python3 scripts/photo/fetch_sources.py` to regenerate originals from the `photo` entries in the manifest. Then generate flood edits and prepare the site JPEGs:

```sh
OPENAI_API_KEY=... node scripts/photo/edit_openai.mjs --all
python3 scripts/photo/postprocess.py --all [--banner]
python3 scripts/photo/contact_sheet.py
```

The edit script supports `--dry-run` to review prompts and output paths without making API requests. Use `--height 1.5` to select heights explicitly; otherwise each location's manifest heights are used.

`postprocess.py` uses the latest raw PNG per height unless `--src` is given. Boxes listed in a location's `edit.restore[height]` (`[x0, y0, x1, y1]` in raw-image pixels) are copied back from the original, to undo small changes the model makes above the waterline such as rewritten shop signs.

For scale, a ground-floor door is about 2.2 m tall: 0.5 m reaches roughly the bottom quarter, 1.5 m about two thirds, and 2.5 m rises above the doors. The street-level panoramas are taken at roughly 1.8–2 m, so above ~2 m the camera itself would be under water: the 2.5 m edit reads the depth from the facades (doors and shop windows fully submerged) rather than from a physically exact viewpoint.

Panoramax photos are licensed CC BY-SA 4.0 or Etalab 2.0 as recorded in the manifest. Keep the photo credit on derived images; CC BY-SA derivatives must retain the same license.
