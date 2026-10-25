// Records real-site clips through the CDP screencast of the running Chrome (1920x1080).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = process.env.OUT_DIR ?? 'captures';
const browser = await chromium.connectOverCDP('http://localhost:29229');
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1920, height: 1080 });
await page.bringToFront();
const cdp = await ctx.newCDPSession(page);

let frames = null;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  if (frames) frames.push({ t: metadata.timestamp, data });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
async function start() { frames = []; await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 }); }
async function stop(name) {
  await cdp.send('Page.stopScreencast');
  const list = frames; frames = null;
  const dir = `${OUT}/${name}`; mkdirSync(dir, { recursive: true });
  let concat = '';
  list.forEach((f, i) => {
    writeFileSync(`${dir}/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    const d = i + 1 < list.length ? list[i + 1].t - f.t : 1 / 30;
    concat += `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${Math.max(d, 0.001).toFixed(4)}\n`;
  });
  concat += `file 'f${String(list.length - 1).padStart(5, '0')}.jpg'\n`;
  writeFileSync(`${dir}/list.txt`, concat);
  execSync(`ffmpeg -v error -y -f concat -safe 0 -i ${dir}/list.txt -vf "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 16 -g 30 ${OUT}/${name}.mp4`);
  const dur = list.length ? (list.at(-1).t - list[0].t).toFixed(1) : 0;
  console.log(name, list.length, 'frames', dur, 's');
}
const sleep = ms => page.waitForTimeout(ms);
const send = async text => { await page.fill('#chat', text); await sleep(600); await page.press('#chat', 'Enter'); };

await page.goto('http://localhost:3000', { waitUntil: 'load' });
await sleep(14000);

// A: live banner, idle city, then "Show me 1910" and the rise over the PPRI zones
await start(); await sleep(4000); await send('Show me 1910'); await sleep(14000); await stop('a_1910');

// B: "What about my home?" camera dive + exposure card; the street scene opens on its own
await start(); await send('What about my home?'); await sleep(20000); await stop('b_home');

// C: the street scene, replay the rise and let it breathe
const heroOpen = await page.evaluate(() => document.getElementById('hero-dialog').open);
console.log('hero open:', heroOpen);
if (heroOpen) { await page.click('#hero-replay'); }
await start(); await sleep(14000); await stop('c_street');
if (heroOpen) { await page.click('#hero-close'); await sleep(1500); }

// D: the time slider 1658 -> 2016 -> 115%
await start();
for (const idx of [0, 1, 2, 3, 4, 5, 7]) { await page.click(`[data-flood-index="${idx}"]`); await sleep(idx === 2 ? 5000 : 3200); }
await stop('d_slider');
await page.click('[data-flood-index="2"]'); await sleep(2000);
if (await page.evaluate(() => document.getElementById('hero-dialog').open)) { await page.click('#hero-close'); await sleep(1000); }

// E: "What should I do?" safety card
await start(); await sleep(1000); await send('What should I do?'); await sleep(9000); await stop('e_safety');
console.log('safety card:', (await page.locator('#safety-card').innerText().catch(() => '')).slice(0, 300).replace(/\n/g, ' | '));
await page.screenshot({ path: 'rec/e_safety_end.png' });
await page.close(); await browser.close();
