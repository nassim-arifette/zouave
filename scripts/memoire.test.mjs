import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isPublicDomain, pickFile, places, fetchMemories } from './fetch-1910.mjs';

const meta = (licence, extra = {}) => ({ LicenseShortName: { value: licence }, DateTimeOriginal: { value: '1910-01-28' }, Artist: { value: '<a href="x">Agence Rol</a>' }, ...extra });
const page = (title, licence, extra) => ({ title, imageinfo: [{ thumburl: `https://upload.example/${encodeURIComponent(title)}`, descriptionurl: `https://commons.example/wiki/${encodeURIComponent(title)}`, width: 1600, mime: 'image/jpeg', extmetadata: meta(licence, extra) }] });
const bercy = places.find(place => place.slug === 'bercy');

test('only public-domain or CC0 files pass the licence filter', () => {
  for (const ok of ['Public domain', 'PD-old-70', 'CC0']) assert.equal(isPublicDomain(meta(ok)), true, ok);
  for (const no of ['CC BY-SA 4.0', 'CC BY 2.0', 'GFDL', '']) assert.equal(isPublicDomain(meta(no)), false, no);
});

test('a Bercy pick must be a 1910 flood photo naming Bercy, in the public domain', () => {
  const pages = {
    1: page('File:Bercy en 2016.jpg', 'Public domain', { DateTimeOriginal: { value: '2016' } }),
    2: page('File:Inondations 1910 Bercy Agence Rol.jpg', 'CC BY-SA 4.0'),
    3: page('File:Inondations de 1910, rue de Bellechasse.jpg', 'Public domain'),
    4: page('File:Inondations de Paris 1910, entrepôts de Bercy.jpg', 'Public domain'),
  };
  assert.equal(pickFile(pages, bercy)?.page.title, 'File:Inondations de Paris 1910, entrepôts de Bercy.jpg');
  delete pages[4];
  assert.equal(pickFile(pages, bercy), null, 'no wrong-place, wrong-year or non-free fallback');
});

test('fetchMemories writes the images and a credited manifest, and skips places without a free match', async () => {
  const out = `${await mkdtemp(`${tmpdir()}/zouave-1910-`)}/`;
  const fetcher = async url => {
    const href = String(url);
    if (href.startsWith('https://upload.example/')) return new Response(new Uint8Array([255, 216, 255]));
    const query = new URL(href).searchParams.get('gsrsearch');
    return Response.json({ query: { pages: /bercy/i.test(query) ? { 9: page('File:Inondations de Paris 1910, entrepôts de Bercy.jpg', 'Public domain') } : {} } });
  };
  const manifest = await fetchMemories({ fetcher, out, log: () => {} });
  assert.equal(manifest.entries.length, 1);
  const [entry] = manifest.entries;
  assert.equal(entry.slug, 'bercy'); assert.equal(entry.author, 'Agence Rol'); assert.equal(entry.license, 'Public domain'); assert.equal(entry.location, 'approximate');
  assert.equal(entry.image, '/memoire/bercy.jpg');
  assert.deepEqual([...await readFile(`${out}bercy.jpg`)], [255, 216, 255]);
  assert.equal(JSON.parse(await readFile(`${out}manifest.json`, 'utf8')).entries[0].file_page, 'https://commons.example/wiki/File%3AInondations%20de%20Paris%201910%2C%20entrep%C3%B4ts%20de%20Bercy.jpg');
});
