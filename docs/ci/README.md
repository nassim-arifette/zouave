# Optional GitHub Actions

Two manual workflows (`workflow_dispatch`). They live here because pushing to `.github/workflows/` needs a token with
the `workflow` scope: copy them into `.github/workflows/` from the GitHub web UI or a local clone, then run them from
the Actions tab.

- `memoire-1910.yml` — runs `scripts/fetch-1910.mjs` on GitHub's runners and commits the public-domain 1910
  photographs to `web/public/memoire/` (same as `npm run fetch-1910` on a machine with internet).
- `voice-smoke.yml` — real OpenAI checks with the `OPENAI_API_KEY` repository secret: `/api/tts` returns a playable MP3
  and replays it from cache (`scripts/voice-smoke.mjs`), then a Live and a Realtime voice session complete a tool
  round trip in Chrome (`scripts/verify_voice.mjs`). Billable, a few cents.
