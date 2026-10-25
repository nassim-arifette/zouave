// Captures the app screenshots the pitch video uses (assets/shots/*.png, 1920×1080), by running Story mode and a chat
// question against a local server. Start the app first (npm start), then: node video/capture.mjs && python3 video/build.py
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./assets/shots/', import.meta.url));
const url = process.env.ZOUAVE_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.addInitScript(() => { try { localStorage.setItem('zouave:speak', 'off'); } catch {} });
const page = await context.newPage();
page.setDefaultTimeout(240_000);
// Interval polling: a software-rendered WebGL page can starve requestAnimationFrame polling.
const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 240_000, polling: 500 });
const caption = re => until(r => new RegExp(r).test(document.getElementById('caption').textContent), re.source);
const shot = async name => { await page.screenshot({ path: `${out}${name}.png` }); console.log('shot', name); };

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
await shot('01-landing');
await page.keyboard.press('d');
await caption(/Zouave of the Alma/); await page.waitForTimeout(2500); await shot('02-hook');
await caption(/watch it rise/i); await page.waitForTimeout(2500); await shot('03-today');
await caption(/June 2016/); await page.waitForTimeout(4000); await shot('04-2016');
await caption(/January 1910/); await until(() => document.getElementById('tour-level')?.textContent === '8.62'); await page.waitForTimeout(3500); await shot('05-1910');
await caption(/fly to/); await page.waitForTimeout(3500);
await caption(/1910-type flood/); await page.waitForTimeout(2500); await shot('06-home');
await until(() => document.getElementById('hero-dialog')?.open); await page.waitForTimeout(6500); await shot('07-street');
await caption(/Three things|Prepare now/); await page.waitForTimeout(2500); await shot('08-advice');
await until(() => !document.getElementById('tour-end').hidden); await page.waitForTimeout(2500); await shot('09-end');
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
await page.evaluate(() => { const end = document.getElementById('tour-end'); if (end) end.hidden = true; });
await page.locator('#chat').fill('Will my cellar flood?'); await page.locator('#chat').press('Enter');
await until(() => !/Checking/.test(document.getElementById('caption').textContent) && document.querySelectorAll('#trace .trace-call').length > 1);
await page.waitForTimeout(5000);
await page.evaluate(() => { for (const id of ['photo-dialog', 'hero-dialog']) { const dialog = document.getElementById(id); if (dialog?.open) dialog.close(); } });
await page.waitForTimeout(1500); await shot('10-trace');
await page.click('#hood-toggle'); await page.waitForTimeout(2500); await shot('11-hood');
await browser.close();
