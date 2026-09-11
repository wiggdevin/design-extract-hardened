import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectPageData } from '../src/crawler.js';

const fixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-bands.html', import.meta.url)), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const COLLECT_OPTS = { maxElements: 5000, ignoreSelectors: [], scopeSelector: null };

let browser;
let page;
let data;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setContent(fixtureHtml);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))));
  data = await page.evaluate(collectPageData, COLLECT_OPTS);
});
after(async () => { if (browser) await browser.close(); });

test('bands are the full-width leaves, in document order, never the page wrappers', () => {
  assert.equal(data.bands.length, 6, JSON.stringify(data.bands.map(b => [b.tag, b.className])));
  assert.deepEqual(data.bands.map(b => b.tag), ['header', 'div', 'div', 'div', 'div', 'footer']);
  for (let i = 1; i < data.bands.length; i++) assert.ok(data.bands[i].bounds.y >= data.bands[i - 1].bounds.y);
  assert.equal(data.bands[0].bounds.y, 0);
  assert.ok(data.pageHeight > 1500);
  for (const b of data.bands) assert.ok(b.bounds.h < data.pageHeight * 0.8, `${b.tag}.${b.className} is ${b.bounds.h} of ${data.pageHeight}`);
  assert.ok(!data.bands.some(b => b.id === 'boxed' || b.id === 'wrapper' || b.tag === 'main'));
});

test('the hero band carries its photo, largest heading, and background colour', () => {
  const hero = data.bands.find(b => /hero/.test(b.className));
  assert.ok(hero);
  assert.equal(hero.media.kind, 'photo');
  assert.ok(hero.media.share >= 0.4, `share ${hero.media.share}`);
  assert.equal(hero.media.src, 'http://fixture.test/img/hero.png');
  assert.deepEqual(hero.heading, { level: 1, fontSize: 56, text: 'Homes built to last' });
  assert.equal(hero.background.color, '#f3efe6');
  assert.equal(hero.background.imageUrl, null);
  assert.equal(hero.background.hasVideo, false);
  assert.equal(hero.bounds.h, 700);
});

test('a two-column band reports two columns and photo media', () => {
  const services = data.bands.find(b => /services/.test(b.className));
  assert.equal(services.columns, 2);
  assert.equal(services.media.kind, 'photo');
  assert.equal(services.heading.level, 2);
  assert.equal(services.heading.fontSize, 36);
});

test('cards, buttons, text, and background are counted per band', () => {
  const reviews = data.bands.find(b => /reviews/.test(b.className));
  assert.ok(reviews.cardCount >= 3);
  assert.equal(reviews.background.color, '#0f2a44');
  assert.equal(reviews.media.kind, 'none');
  const cta = data.bands.find(b => /cta/.test(b.className));
  assert.ok(cta.buttonCount >= 1);
  assert.ok(cta.textLength > 10);
  assert.ok(cta.text.includes('Ready to start?'));
  assert.equal(data.bands[0].position, 'static');
  assert.equal(data.bands[0].bounds.h, 100);
});

test('heading text is capped at 120 characters', async () => {
  await page.evaluate(() => { document.querySelector('.cta h2').textContent = 'x'.repeat(300); });
  const long = await page.evaluate(collectPageData, COLLECT_OPTS);
  assert.equal(long.bands.find(b => /cta/.test(b.className)).heading.text.length, 120);
});

test('sections and bands record y in document coordinates after a scroll', async () => {
  await page.evaluate(() => window.scrollTo(0, 500));
  const scrolled = await page.evaluate(collectPageData, COLLECT_OPTS);
  assert.equal(await page.evaluate(() => window.scrollY), 500, 'the collector itself never scrolls');
  assert.equal(scrolled.sections.find(s => s.tag === 'header').bounds.y, 0);
  assert.equal(scrolled.bands[0].bounds.y, 0);
  assert.equal(typeof scrolled.sections[0].position, 'string');
});

const narrowFixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-narrow-sections.html', import.meta.url)), 'utf8');

test('an oversized leaf whose real sections sit under the width threshold is re-walked, not dropped', async () => {
  const narrowPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await narrowPage.setContent(narrowFixtureHtml);
  const narrow = await narrowPage.evaluate(collectPageData, COLLECT_OPTS);
  assert.equal(narrow.bands.length, 6, JSON.stringify(narrow.bands.map(b => [b.tag, b.className, b.bounds.h])));
  for (const b of narrow.bands) assert.ok(b.bounds.h <= 0.8 * narrow.pageHeight, `${b.tag}.${b.className} is ${b.bounds.h} of ${narrow.pageHeight}`);
  const sections = narrow.bands.filter(b => b.className && /^s[1-4]$/.test(b.className));
  assert.equal(sections.length, 4);
  for (const s of sections) assert.equal(s.bounds.w, 1000);
  assert.equal(narrow.bandsCapped, false);
  await narrowPage.close();
});

const passthroughFixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-passthrough.html', import.meta.url)), 'utf8');

test('the walk sees through pass-through wrappers: display:contents, a zero-height flow wrapper, but not a collapsed overflow:hidden panel', async () => {
  const ptPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await ptPage.setContent(passthroughFixtureHtml);
  const pt = await ptPage.evaluate(collectPageData, COLLECT_OPTS);

  // (a) #site is display:contents and holds header + main; both are seen
  // through to their real content. (b) one of main's sections is wrapped in
  // a zero-height div.zero (overflow: visible) and is still found as a band.
  // (c) div.accordion is zero-height with overflow: hidden — a deliberately
  // collapsed panel — and its section is NOT flattened into a band; see the
  // comment on isPassThrough in src/crawler.js for why.
  assert.equal(pt.bands.length, 5, JSON.stringify(pt.bands.map(b => [b.tag, b.className, b.bounds.h])));
  assert.deepEqual(pt.bands.map(b => b.tag), ['header', 'section', 'section', 'section', 'section']);
  const headings = pt.bands.map(b => b.heading && b.heading.text).filter(Boolean);
  assert.deepEqual(headings, ['One', 'Two', 'Three', 'Four (zero-height wrapper)']);
  assert.ok(!headings.includes('Hidden panel'), 'the collapsed accordion panel must not become a band');

  for (const b of pt.bands) assert.equal(b.bounds.w, 1280, `${b.tag}.${b.className} is ${b.bounds.w} wide`);
  for (const b of pt.bands) assert.ok(b.bounds.h <= 0.8 * pt.pageHeight, `${b.tag}.${b.className} is ${b.bounds.h} of ${pt.pageHeight}`);
  const ys = pt.bands.map(b => b.bounds.y);
  assert.equal(new Set(ys).size, ys.length, `duplicate bounds.y among ${JSON.stringify(ys)}`);
  assert.equal(pt.bandsCapped, false);
  await ptPage.close();
});
