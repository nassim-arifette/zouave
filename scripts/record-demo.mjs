// Records the Story mode as a backup video (silent .webm; the narration is the browser's or OpenAI's audio, which
// Playwright cannot capture — record the screen with sound for the pitch itself). Run against `npm start`:
//   node scripts/record-demo.mjs            → zouave-story.webm in the current directory
// Env: ZOUAVE_URL (default http://localhost:3000), CHROME_PATH (a local Chrome uses the real GPU; recommended).
import { chromium } from 'playwright';
import { rename } from 'node:fs/promises';
const url = process.env.ZOUAVE_URL ?? 'http://localhost:3000';
const size = { width: 1920, height: 1080 };
const browser = await chromium.launch({ headless: !process.env.HEADFUL, executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: '.', size } });
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Page error:', error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await page.keyboard.press('d');
  await page.waitForFunction(() => document.body.classList.contains('tour-active'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.body.classList.contains('tour-active'), null, { timeout: 240000, polling: 1000 });
  await page.waitForTimeout(5000);
  const video = page.video();
  await context.close();
  await rename(await video.path(), 'zouave-story.webm');
  console.log('Saved zouave-story.webm');
} finally { await browser.close(); }
