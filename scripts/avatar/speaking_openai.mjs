#!/usr/bin/env node
// Creates the "speaking" (mouth open) frame of an avatar option with a masked OpenAI image edit,
// then the finalize step pastes back only the mouth region so both frames stay pixel-aligned.
// Usage: OPENAI_API_KEY=... node scripts/avatar/speaking_openai.mjs --options 1,2,4 [--quality high]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MOUTH_BOXES } from "./prompts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    options: { type: "string", default: Object.keys(MOUTH_BOXES).join(",") },
    model: { type: "string", default: "gpt-image-2.5-sunburst" },
    quality: { type: "string", default: "high" },
    out: { type: "string", default: path.join(here, "out") },
  },
});
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

const PROMPT =
  "Edit only the mouth: the same statue is now speaking, lips parted with the mouth open in a natural " +
  "mid-word 'ah' shape, a dark opening between the lips (stone/bronze sculpted, no teeth detail needed). " +
  "Keep everything else identical: same face, beard, lighting, material, framing, background and colours.";

async function speak(id) {
  const src = path.join(args.out, `option${id}.png`);
  const mask = path.join(args.out, `option${id}_mouthmask.png`);
  const form = new FormData();
  for (const [k, v] of Object.entries({ model: args.model, prompt: PROMPT, quality: args.quality, size: "1024x1024", n: 1 })) {
    form.append(k, String(v));
  }
  form.append("image[]", new Blob([await readFile(src)], { type: "image/png" }), path.basename(src));
  form.append("mask", new Blob([await readFile(mask)], { type: "image/png" }), path.basename(mask));
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`option ${id}: ${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`);
  const file = path.join(args.out, `option${id}_speaking_raw.png`);
  await writeFile(file, Buffer.from(body.data[0].b64_json, "base64"));
  return file;
}

const results = await Promise.allSettled(args.options.split(",").map(speak));
let failed = 0;
for (const r of results) {
  if (r.status === "fulfilled") console.log("wrote", r.value);
  else { failed++; console.error(r.reason.message); }
}
process.exit(failed ? 1 : 0);
