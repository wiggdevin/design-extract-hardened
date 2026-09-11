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

test('stack.classTokens is the unique class-token set, not the whole-string sample', () => {
  assert.ok(Array.isArray(data.stack.classTokens), 'classTokens must be an array');
  assert.equal(new Set(data.stack.classTokens).size, data.stack.classTokens.length, 'classTokens must be unique');
  assert.ok(data.stack.classTokens.includes('fusion-fullwidth'), JSON.stringify(data.stack.classTokens));
  assert.ok(Array.isArray(data.stack.classNameSample));
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

const avadaFixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-avada-rows.html', import.meta.url)), 'utf8');

test('the band-box width test is parent-relative below the top level, so an Avada site-width row decomposes', async () => {
  const avadaPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await avadaPage.setContent(avadaFixtureHtml);
  const avada = await avadaPage.evaluate(collectPageData, COLLECT_OPTS);

  // The leading section (a landmark-shaped Wise/N26 reproduction: section >
  // div > div > div, that innermost div holding two REAL width-qualifying
  // siblings, a 150px-tall one and a 400px-tall one) stays ONE band with
  // the section's own bounds — the sibling pair would trigger the ordinary
  // multi-kid branch just fine on their own, but chain[0] here is the
  // section, so that branch must not reset chain and hand the band to one
  // of the two children instead (Wise's exact regression: section > div >
  // mw-container x3, the innermost mw-container's own two real children —
  // a 268px row and an 871px block — became their own bands, one of them
  // inheriting the hero role that belonged to the section).
  //
  // Row 1 (two 50%-width columns) stays one band — the fullwidth — since a
  // real side-by-side grid is not decomposed further. Row 2 (three stacked
  // 100%-of-row columns) decomposes into three bands, one per column, each
  // reporting the column's own width (1100). Row 3 (one 100%-of-row column)
  // stays one band — the fullwidth — same as row 1. Row 4 (a full-row-width
  // heading followed by six 50%-width cards wrapping into three rows of two)
  // also stays one band — the fullwidth — since none of its children pass
  // the band-box test (the heading fails height, the cards fail width), same
  // shape as the reference page's band 8. The trailing footer (a landmark
  // whose real content sits in a centered 1100px inner wrapper, itself
  // holding three full-row-width nav blocks) stays ONE band too — a
  // landmark is never peered into for a lone-child bypass, so the walk
  // never reaches the nav blocks that would otherwise pass the strict width
  // test one level down and replace the footer's own bounds.
  assert.equal(avada.bands.length, 8, JSON.stringify(avada.bands.map(b => [b.tag, b.className, b.bounds.w, b.bounds.h])));
  assert.deepEqual(avada.bands.map(b => b.bounds.w), [1280, 1280, 1100, 1100, 1100, 1280, 1280, 1280]);
  const heroLikeBand = avada.bands.find((b) => b.tag === 'section');
  assert.ok(heroLikeBand, `expected a section band, got tags ${JSON.stringify(avada.bands.map((b) => b.tag))}`);
  // ~550 (150 + 400) plus the h3 headings' own margin, which collapses
  // through the unpadded wrapper divs into the section's rendered height.
  assert.ok(heroLikeBand.bounds.h >= 540 && heroLikeBand.bounds.h <= 600, JSON.stringify(heroLikeBand));
  assert.equal(avada.bands.filter((b) => /hs-short|hs-tall/.test(b.className)).length, 0,
    'the section must not decompose into its short/tall inner children');
  for (let i = 1; i < avada.bands.length; i++) assert.ok(avada.bands[i].bounds.y >= avada.bands[i - 1].bounds.y);
  for (const b of avada.bands) assert.ok(b.bounds.h <= 0.8 * avada.pageHeight, `${b.tag}.${b.className} is ${b.bounds.h} of ${avada.pageHeight}`);
  assert.equal(avada.bandsCapped, false);

  // The column rule must group children by row, not anchor on the first
  // child: row 1's two 50%-width columns are still columns === 2 (this
  // already worked, since the first child happened to be part of the pair),
  // and row 4's heading-then-grid band is now also columns === 2 (this is
  // the fix — anchoring on the heading as rects[0] used to read the whole
  // grid as one column, reference-page band 8's exact bug).
  const row1Band = avada.bands.find((b) => /\bfw1\b/.test(b.className));
  assert.equal(row1Band.columns, 2, JSON.stringify(row1Band));
  const row4Band = avada.bands.find((b) => /\bfw4\b/.test(b.className));
  assert.equal(row4Band.columns, 2, JSON.stringify(row4Band));

  // The footer must be ONE band with tag footer — not three nav bands from
  // its centered inner wrapper.
  const footerBand = avada.bands.find((b) => b.tag === 'footer');
  assert.ok(footerBand, `expected a footer band, got tags ${JSON.stringify(avada.bands.map((b) => b.tag))}`);
  assert.equal(footerBand.bounds.w, 1280, JSON.stringify(footerBand));
  assert.equal(avada.bands.filter((b) => b.tag === 'nav').length, 0, 'the footer must not decompose into its nav blocks');
  await avadaPage.close();
});

const relaxedOnceFixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-relaxed-once.html', import.meta.url)), 'utf8');

test('a relaxed width share applies to exactly one level, not to every deeper walk call', async () => {
  const relaxedPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await relaxedPage.setContent(relaxedOnceFixtureHtml);
  const relaxed = await relaxedPage.evaluate(collectPageData, COLLECT_OPTS);

  // main (100% wide) is an oversized leaf whose four sections are only 1000px
  // (78% of the 1280 viewport) — under the 90% strict test they fail, so the
  // retry relaxes to 60% and finds them. Each section then holds two 70%-wide
  // columns (70% of the SECTION, not the viewport): 70% clears the relaxed
  // 60% floor but not the standard 90% one. If the relaxed share carried
  // into the sections' own walk (the bug), those columns would each pass
  // the inherited 60% test and become their own bands — 4 sections x 2
  // columns = 8 bands instead of 4, and the sections themselves would
  // vanish as band boundaries.
  assert.equal(relaxed.bands.length, 4, JSON.stringify(relaxed.bands.map(b => [b.className, b.bounds.w, b.bounds.h])));
  for (const b of relaxed.bands) assert.equal(b.bounds.w, 1000, JSON.stringify(b));
  assert.deepEqual(relaxed.bands.map(b => b.className), ['s1', 's2', 's3', 's4']);
  assert.equal(relaxed.bandsCapped, false);
  await relaxedPage.close();
});
