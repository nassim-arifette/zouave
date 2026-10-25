#!/usr/bin/env node
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPhotosRoot = path.resolve(scriptDir, "../../web/public/photos");
const outputRoot = path.join(scriptDir, "out");

function usage() {
  return [
    "Usage: node scripts/photo/edit_openai.mjs (--all | --slug <slug>[,<slug>...]) [options]",
    "Options:",
    "  --height <height>[,<height>...]  Override manifest heights",
    "  --model <model>                  Override the prompts.json model",
    "  --quality <quality>              Image quality (default: high)",
    "  --concurrency <count>             Concurrent requests (default: 2)",
    "  --manifest <path>                 Manifest path override",
    "  --photos-root <path>              Photo directory override",
    "  --dry-run                         Print requests without calling the API",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    slugs: [],
    heights: [],
    all: false,
    dryRun: false,
    quality: "high",
    concurrency: 2,
    photosRoot: defaultPhotosRoot,
    manifestPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--slug" || arg === "--height") {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      const values = value.split(",").map((item) => item.trim()).filter(Boolean);
      if (arg === "--slug") options.slugs.push(...values);
      else options.heights.push(...values);
    } else if (arg === "--model" || arg === "--quality" || arg === "--concurrency" ||
               arg === "--manifest" || arg === "--photos-root") {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === "--model") options.model = value;
      else if (arg === "--quality") options.quality = value;
      else if (arg === "--concurrency") options.concurrency = Number(value);
      else if (arg === "--manifest") options.manifestPath = path.resolve(value);
      else options.photosRoot = path.resolve(value);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) return options;
  if (options.all === Boolean(options.slugs.length)) {
    throw new Error("Choose exactly one of --all or --slug.");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  options.manifestPath ??= path.join(options.photosRoot, "manifest.json");
  return options;
}

function normalizeHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`Invalid height: ${value}`);
  }
  return String(height);
}

function jpegDimensions(bytes, filename) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Not a JPEG image: ${filename}`);
  }

  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) break;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (sofMarkers.has(marker)) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error(`Could not read JPEG dimensions: ${filename}`);
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function nextOutputPath(slug, height, reserved = new Set()) {
  const directory = path.join(outputRoot, slug);
  const base = `flood_${height}m`;
  for (let version = 1; ; version += 1) {
    const suffix = version === 1 ? "" : `_v${version}`;
    const filename = path.join(directory, `${base}${suffix}.png`);
    if (!reserved.has(filename) && !(await exists(filename))) {
      reserved.add(filename);
      return filename;
    }
  }
}

async function writeWithoutOverwrite(slug, height, imageBytes) {
  const directory = path.join(outputRoot, slug);
  await mkdir(directory, { recursive: true });
  for (;;) {
    const filename = await nextOutputPath(slug, height);
    try {
      await writeFile(filename, imageBytes, { flag: "wx" });
      return filename;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

function buildJobs(locations, options, promptConfig) {
  const calibrations = promptConfig.calibration ?? {};
  const jobs = [];
  for (const location of locations) {
    const heights = options.heights.length
      ? [...new Set(options.heights.map(normalizeHeight))]
      : [...new Set((location.heights ?? []).map(normalizeHeight))];
    for (const height of heights) {
      const calibration = calibrations[height];
      if (typeof calibration !== "string") {
        throw new Error(`No calibration for height ${height} in prompts.json.`);
      }
      jobs.push({
        location,
        height,
        prompt: promptConfig.prompt
          .replaceAll("{height}", height)
          .replaceAll("{calibration}", calibration),
        originalPath: path.join(options.photosRoot, location.slug, "original.jpg"),
      });
    }
  }
  return jobs;
}

async function generate(job, options, apiKey) {
  const original = await readFile(job.originalPath);
  const { width, height } = jpegDimensions(original, job.originalPath);
  const size = `${width}x${height}`;
  const form = new FormData();
  form.append("model", options.model);
  form.append("image[]", new Blob([original], { type: "image/jpeg" }), "original.jpg");
  form.append("prompt", job.prompt);
  form.append("size", size);
  form.append("quality", options.quality);
  form.append("output_format", "png");
  form.append("n", "1");

  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (response.ok ||
        !(response.status === 429 || (response.status >= 500 && response.status <= 599)) ||
        attempt === 3) {
      break;
    }

    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    const retryDateDelay = retryAfter && Number.isNaN(retryAfterSeconds)
      ? Date.parse(retryAfter) - Date.now()
      : NaN;
    const delay = Number.isFinite(retryAfterSeconds)
      ? Math.min(retryAfterSeconds * 1000, 30_000)
      : Number.isFinite(retryDateDelay)
        ? Math.min(Math.max(retryDateDelay, 0), 30_000)
        : 1000 * 2 ** (attempt - 1);
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const requestId = response.headers.get("x-request-id") ?? "unavailable";
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`OpenAI returned non-JSON HTTP ${response.status}: ${responseText}`);
  }
  if (!response.ok) {
    throw new Error(`OpenAI request failed (HTTP ${response.status}, x-request-id=${requestId}): ${JSON.stringify(body)}`);
  }
  const encodedImage = body.data?.[0]?.b64_json;
  if (!encodedImage) {
    throw new Error(`OpenAI response contained no image (x-request-id=${requestId}).`);
  }

  const outputPath = await writeWithoutOverwrite(job.location.slug, job.height, Buffer.from(encodedImage, "base64"));
  console.log(
    `Generated ${outputPath} | x-request-id=${requestId} | usage=${JSON.stringify(body.usage ?? null)}`,
  );
  return { job, size, outputPath };
}

async function writeManifest(manifestPath, manifest) {
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, manifestPath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const [manifestText, promptText] = await Promise.all([
    readFile(options.manifestPath, "utf8"),
    readFile(path.join(scriptDir, "prompts.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const promptConfig = JSON.parse(promptText);
  options.model ??= promptConfig.model;
  const bySlug = new Map((manifest.locations ?? []).map((location) => [location.slug, location]));

  let locations;
  if (options.all) {
    locations = manifest.locations ?? [];
  } else {
    const requestedSlugs = [...new Set(options.slugs)];
    const unknown = requestedSlugs.filter((slug) => !bySlug.has(slug));
    if (unknown.length) throw new Error(`Unknown location slug(s): ${unknown.join(", ")}`);
    locations = requestedSlugs.map((slug) => bySlug.get(slug));
  }
  if (!locations.length) throw new Error("No locations selected.");

  const jobs = buildJobs(locations, options, promptConfig);
  if (!jobs.length) throw new Error("No heights selected.");
  const reserved = new Set();
  for (const job of jobs) {
    const original = await readFile(job.originalPath);
    const { width, height } = jpegDimensions(original, job.originalPath);
    job.size = `${width}x${height}`;
    job.plannedOutput = await nextOutputPath(job.location.slug, job.height, reserved);
  }

  if (options.dryRun) {
    for (const job of jobs) {
      console.log(
        `DRY RUN ${job.location.slug} @ ${job.height}m | model=${options.model} | quality=${options.quality} | size=${job.size} | output=${job.plannedOutput}`,
      );
      console.log(`Prompt: ${job.prompt}`);
    }
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required unless --dry-run is used.");
  }

  const results = [];
  let nextJob = 0;
  const worker = async () => {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob++];
      try {
        results.push(await generate(job, options, apiKey));
      } catch (error) {
        console.error(`Failed ${job.location.slug} @ ${job.height}m: ${error.message}`);
        process.exitCode = 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, jobs.length) }, worker));

  if (results.length) {
    for (const { job, size } of results) {
      const edit = (job.location.edit ??= {});
      edit.model = options.model;
      edit.quality = options.quality;
      edit.size = size;
      edit.generated_at = new Date().toISOString();
      const prompts = (edit.prompts ??= {});
      prompts[job.height] = job.prompt;
    }
    await writeManifest(options.manifestPath, manifest);
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 1;
}
