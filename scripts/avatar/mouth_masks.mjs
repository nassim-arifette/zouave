#!/usr/bin/env node
// Writes option<N>_mouthmask.png: opaque everywhere except a transparent ellipse over the mouth
// (OpenAI edits the transparent area). Pure Node, no deps: emits an RGBA PNG by hand.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { MOUTH_BOXES } from "./prompts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(here, "out");
const S = 1024;

function png(rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const [id, [x0, y0, x1, y1]] of Object.entries(MOUTH_BOXES)) {
  const buf = Buffer.alloc(S * S * 4, 255);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) buf[(y * S + x) * 4 + 3] = 0;
  }
  const file = path.join(out, `option${id}_mouthmask.png`);
  await writeFile(file, png(buf));
  console.log("wrote", file);
}
