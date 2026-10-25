import { chromium } from 'playwright';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? `${homedir()}/.local/bin/google-chrome`, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Et chez moi/ }).click();
  await page.locator('#exposure-card').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Voir ma rue en simulation/ }).click();
  await page.locator('#photo-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#photo-image').naturalWidth > 0);
  assert.match(await page.locator('#photo-label').innerText(), /4 Rue Traversière.*1.5 m simulés/);
  assert.match(await page.locator('#photo-credit').innerText(), /Lejun.*CC BY-SA 4.0/);
  const badge = await page.locator('.photo-header span').boundingBox();
  const photo = await page.locator('#photo-image').boundingBox();
  assert.ok(badge.y >= photo.y && badge.y + badge.height <= photo.y + photo.height);
  assert.match(await page.locator('.photo-header span').innerText(), /SIMULATION/);
  await page.screenshot({ path: `${homedir()}/zouave-notes/shots/06-photo-simulation.png` });
  await page.getByRole('button', { name: 'Fermer la photo' }).click();
  await page.locator('#photo-dialog').waitFor({ state: 'hidden' });
  console.log('PASS photo: real manifest, nearest available 1.5 m image, visible HTML SIMULATION overlay, Lejun credit + CC BY-SA 4.0, modal close.');
  console.log(`Screenshot: ${homedir()}/zouave-notes/shots/06-photo-simulation.png`);
} finally { await browser.close(); }
