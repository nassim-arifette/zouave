#!/usr/bin/env node
// Generates the Zouave avatar options with the OpenAI Images API (edit endpoint with reference photos).
// Usage: OPENAI_API_KEY=... node scripts/avatar/generate_openai.mjs [--options 1,2,3,4] [--quality high]
//        [--model gpt-image-2.5-sunburst] [--variants 1] [--no-refs] [--out scripts/avatar/out]
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { OPTIONS, REFERENCES } from "./prompts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    options: { type: "string", default: OPTIONS.map((o) => o.id).join(",") },
    model: { type: "string", default: "gpt-image-2.5-sunburst" },
    quality: { type: "string", default: "high" },
    size: { type: "string", default: "1024x1024" },
    variants: { type: "string", default: "1" },
    out: { type: "string", default: path.join(here, "out") },
    "no-refs": { type: "boolean", default: false },
  },
});

const API = "https://api.openai.com/v1";
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

const exists = (p) => access(p).then(() => true, () => false);

async function fetchReference(ref, dir) {
  const file = path.join(dir, ref.title.replace(/^File:/, "").replace(/[^\w.-]+/g, "_"));
  if (await exists(file)) return file;
  const q = new URLSearchParams({
    action: "query", format: "json", prop: "imageinfo", iiprop: "url", iiurlwidth: "1024", titles: ref.title,
  });
  const ua = { "User-Agent": "zouave-avatar/1.0 (hackathon demo)" };
  const meta = await (await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: ua })).json();
  const info = Object.values(meta.query.pages)[0].imageinfo[0];
  const res = await fetch(info.thumburl ?? info.url, { headers: ua });
  if (!res.ok) throw new Error(`reference download failed: ${ref.title} (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function generate(option, variant, refs) {
  const common = { model: args.model, prompt: option.prompt, size: args.size, quality: args.quality, n: 1 };
  let res;
  if (refs.length) {
    const form = new FormData();
    for (const [k, v] of Object.entries(common)) form.append(k, String(v));
    for (const ref of refs) {
      form.append("image[]", new Blob([await readFile(ref)], { type: "image/jpeg" }), path.basename(ref));
    }
    res = await fetch(`${API}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  } else {
    res = await fetch(`${API}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(common),
    });
  }
  const body = await res.json();
  if (!res.ok) {
    const e = body.error ?? {};
    throw new Error(`option ${option.id}: ${res.status} ${e.code ?? ""} ${e.message ?? ""} ${JSON.stringify(e.moderation_details ?? "")}`);
  }
  const file = path.join(args.out, `option${option.id}${variant > 1 ? `_v${variant}` : ""}.png`);
  await writeFile(file, Buffer.from(body.data[0].b64_json, "base64"));
  await writeFile(file.replace(/\.png$/, ".json"), JSON.stringify(
    { id: option.id, label: option.label, model: args.model, quality: args.quality, prompt: option.prompt, usage: body.usage }, null, 2));
  return file;
}

await mkdir(args.out, { recursive: true });
const refDir = path.join(here, "refs");
await mkdir(refDir, { recursive: true });
const refs = args["no-refs"] ? [] : await Promise.all(REFERENCES.map((r) => fetchReference(r, refDir)));

const wanted = new Set(args.options.split(",").map(Number));
const jobs = OPTIONS.filter((o) => wanted.has(o.id)).flatMap((o) =>
  Array.from({ length: Number(args.variants) }, (_, i) => generate(o, i + 1, refs)));
const results = await Promise.allSettled(jobs);
let failed = 0;
for (const r of results) {
  if (r.status === "fulfilled") console.log("wrote", r.value);
  else { failed++; console.error(r.reason.message); }
}
process.exit(failed ? 1 : 0);
