import { chromium } from 'playwright';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { floodPresets } from '../web/src/flood-level.ts';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? `${homedir()}/.local/bin/google-chrome`, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  const cases = [
    ['2016', 'dry', /Au sec/, /original\.jpg$/, /6,10/],
    ['1955', 'possible', /au sec ou jusqu’à 0,5 m/, /flood_0\.5m\.jpg$/, /7,12/],
    ['1910', 'flooded', /1 à 2 m/, /flood_1\.5m\.jpg$/, /8,62/],
    ['115', 'flooded', /1,5 à 2,5 m/, /flood_2\.5m\.jpg$/, /9,10/],
  ];
  for (const [id, status, depth, photo, level] of cases) {
    const index = floodPresets.findIndex(p => p.id === id);
    await page.locator('#flood-slider').evaluate((el, index) => { el.value = String(index); el.dispatchEvent(new Event('input', { bubbles: true })); }, index);
    await page.waitForFunction(id => document.querySelector('#timeline-title').textContent.includes(id === '115' ? '115' : id), id);
    await page.waitForFunction(status => document.querySelector('.timeline-depth')?.dataset.status === status, status);
    await page.waitForFunction(pattern => {
      const image = document.querySelector('#timeline-photo');
      return image?.naturalWidth > 0 && new RegExp(pattern).test(image.getAttribute('src'));
    }, photo.source);
    assert.match(await page.locator('.timeline-depth').innerText(), depth);
    assert.match(await page.locator('#timeline-level').innerText(), level);
    assert.match(await page.locator('#timeline-photo').getAttribute('src'), photo);
    assert.match(await page.locator('#timeline-level').innerText(), id === '115' ? /Officiel/ : /Mesuré/);
    if (id === '1955') assert.match(await page.locator('.timeline-verdict').innerText(), /Peut-être/);
    if (id === '115') assert.match(await page.locator('#legend-note').innerText(), /moins de 50 cm/);
    const photoLabel = await page.locator('.timeline-image-label').innerText();
    assert.doesNotMatch(photoLabel, /illustration|simulation|simulés/i);
    if (id !== '2016') assert.match(photoLabel, /Eau à [\d,]+ m.*Estimé/);
    await page.screenshot({ path: `${homedir()}/zouave-notes/shots/timeline-${id}.png` });
  }
  await page.locator(`[data-flood-index="${floodPresets.findIndex(p => p.id === '1955')}"]`).click();
  await page.waitForFunction(() => document.querySelector('#caption').textContent.includes('7,12'));
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const boxes = await page.evaluate(() => Object.fromEntries(['#flood-timeline', '.scenario-bar', '.cards'].map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return [selector, { x, y, width, height }];
    })));
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert.equal(overlaps(boxes['#flood-timeline'], boxes['.scenario-bar']), false, 'timeline covers scenario bar');
    assert.equal(overlaps(boxes['#flood-timeline'], boxes['.cards']), false, 'timeline covers photo card');
    assert.equal(overlaps(boxes['.scenario-bar'], boxes['.cards']), false, 'scenario bar covers photo card');
    await page.locator('#timeline-photo').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${homedir()}/zouave-notes/shots/timeline-layout-${viewport.width}x${viewport.height}.png` });
    console.log(`PASS layout ${viewport.width}×${viewport.height}: timeline, scenario bar and photo card do not overlap.`);
  }
  await page.getByRole('button', { name: /Pire que 1910/ }).click();
  await page.locator('#exposure-card').filter({ hasText: 'Emprise seulement' }).waitFor();
  await page.getByRole('button', { name: /Aujourd’hui/, exact: false }).click();
  await page.locator('#exposure-card').filter({ hasText: 'Aucune simulation' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS timeline: slider 2016 banks/dry home + original; 1955 possible/0.5 m; 1910 official 1–2 m/1.5 m; 115% estimated 1.5–2.5 m/2.5 m; source badges; classic extreme/today still work; no page errors.');
  console.log(`Screenshots: ${homedir()}/zouave-notes/shots/timeline-{2016,1955,1910,115}.png`);
} finally { await browser.close(); }
