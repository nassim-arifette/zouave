import { chromium } from 'playwright';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? `${homedir()}/.local/bin/google-chrome`, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [query, expected] of [['', 'stone'], ['?avatar=living-stone', 'living-stone'], ['?avatar=bronze-flood', 'bronze-flood'], ['?avatar=', 'stone'], ['?avatar=unknown', 'stone']]) {
    await page.goto(`http://localhost:3000/${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => [...document.querySelectorAll('#avatar-ring img')].every(img => img.complete && img.naturalWidth > 0));
    assert.match(await page.locator('#avatar').getAttribute('src'), new RegExp(`/${expected}/avatar@2x.webp$`));
    assert.match(await page.locator('.avatar-mouth').getAttribute('src'), new RegExp(`/${expected}/avatar-speaking@2x.webp$`));
  }
  await page.getByRole('button', { name: 'Montre-moi 1910', exact: false }).click();
  await page.waitForFunction(() => document.querySelector('#avatar-ring').classList.contains('speaking'));
  const opacity = new Set();
  for (let i = 0; i < 10; i++) {
    opacity.add(await page.locator('.avatar-mouth').evaluate(el => getComputedStyle(el).opacity));
    await page.waitForTimeout(75);
  }
  assert.deepEqual([...opacity].sort(), ['0', '1']);
  await page.screenshot({ path: `${homedir()}/zouave-notes/shots/07-avatar.png` });
  await page.waitForFunction(() => !document.querySelector('#avatar-ring').classList.contains('speaking'));
  assert.equal(await page.locator('.avatar-mouth').evaluate(el => getComputedStyle(el).opacity), '0');
  await page.locator('#avatar-ring').evaluate(el => el.classList.add('listening'));
  assert.equal(await page.locator('#avatar-ring').evaluate(el => getComputedStyle(el).animationName), 'avatar-breathe');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#avatar-ring').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('link[rel="icon"]').first().getAttribute('href'), '/zouave/favicon.svg');
  assert.deepEqual(errors, []);
  console.log('PASS avatar: three variants, empty/invalid default, loaded WebP frames, fallback mouth alternation and idle reset, listening breathing/halo styling, reduced motion, favicon.');
  console.log(`Screenshot: ${homedir()}/zouave-notes/shots/07-avatar.png`);
} finally { await browser.close(); }
