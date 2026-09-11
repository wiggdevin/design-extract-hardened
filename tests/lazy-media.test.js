import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectPageData } from '../src/crawler.js';

const fixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/lazy-placeholders.html', import.meta.url)), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const COLLECT_OPTS = { maxElements: 5000, ignoreSelectors: [], scopeSelector: null };

let browser; let page; let data;
before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setContent(fixtureHtml);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))));
  data = await page.evaluate(collectPageData, COLLECT_OPTS);
});
after(async () => { if (browser) await browser.close(); });

const band = (cls) => data.bands.find((b) => b.className.includes(cls));

test('a lazysizes placeholder resolves to the data-orig-src URL as photo media', () => {
  const a = band('lazy-a');
  assert.equal(a.media.kind, 'photo');
  assert.equal(a.media.src, 'http://fixture.test/img/a.png');
  assert.ok(a.media.share >= 0.2, `share ${a.media.share}`);
});

test('a natively loaded srcset image keeps its currentSrc', () => {
  const b = band('native-b');
  assert.equal(b.media.kind, 'photo');
  assert.equal(b.media.src, 'http://fixture.test/img/b.png');
});

test('data-bg on an unpainted block becomes the band background image and photo media', () => {
  const c = band('bg-c');
  assert.equal(c.background.imageUrl, 'http://fixture.test/img/c.png');
  assert.equal(c.media.kind, 'photo');
});

test('a video band records its poster', () => {
  const d = band('video-d');
  assert.equal(d.media.kind, 'video');
  assert.equal(d.media.poster, 'http://fixture.test/img/poster.png');
  assert.equal(d.background.hasVideo, true);
});

test('results.images marks the unresolved placeholder and resolves its src', () => {
  const lazy = data.images.find((i) => i.classList.includes('lazyload'));
  assert.equal(lazy.lazyUnresolved, true);
  assert.equal(lazy.src, 'http://fixture.test/img/a.png');
  assert.ok(lazy.currentSrc.startsWith('data:image/svg+xml'));
  const native = data.images.find((i) => i.src === 'http://fixture.test/img/b.png');
  assert.equal(native.lazyUnresolved, false);
});

test('an unpainted band inherits the nearest painted ancestor background and says so', () => {
  const a = band('lazy-a');
  assert.equal(a.background.color, '#ffffff');
  assert.equal(a.background.inherited, true);
});
