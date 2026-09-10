import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectPageData } from '../src/crawler.js';

const fixtureHtml = readFileSync(
  fileURLToPath(new URL('./fixtures/collector-hygiene.html', import.meta.url)),
  'utf8',
);

let browser;
let page;
let data;

before(async () => {
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new Error(`chromium failed to launch — collector-hygiene tests require a local chromium install: ${err.message}`);
  }
  page = await browser.newPage();
  // setContent never navigates, so this fixture never touches the network.
  await page.setContent(fixtureHtml);
  data = await page.evaluate(collectPageData, { maxElements: 5000, ignoreSelectors: [], scopeSelector: null });
});

after(async () => {
  if (browser) await browser.close();
});

test('collectPageData excludes head and non-rendering tags from computedStyles', () => {
  const bannedTags = new Set(['script', 'style', 'link', 'meta', 'path', 'source', 'head', 'title', 'base', 'template', 'noscript', 'track']);
  for (const entry of data.computedStyles) {
    assert.equal(bannedTags.has(entry.tag), false, `unexpected tag in computedStyles: ${entry.tag}`);
  }
});

test('collectPageData keeps the svg root but not its internal path', () => {
  const svgRoot = data.computedStyles.find((e) => e.tag === 'svg');
  assert.ok(svgRoot, 'svg root element should be collected');
  const pathEl = data.computedStyles.find((e) => e.tag === 'path');
  assert.equal(pathEl, undefined, 'svg descendant (path) should be excluded');
});

test('collectPageData preserves existing computedStyles fields', () => {
  const prose = data.computedStyles.find((e) => e.tag === 'p');
  assert.ok(prose, 'expected the <p> element to be collected');
  assert.equal(typeof prose.fontFamily, 'string');
  assert.equal(typeof prose.borderRadius, 'string');
  assert.equal(typeof prose.hasText, 'boolean');
  assert.equal(prose.hasText, true);
  assert.ok('lineWidth' in prose);
});

test('image src resolves through currentSrc/srcset fallback chain', () => {
  const images = data.images;
  assert.ok(Array.isArray(images) && images.length >= 2, 'expected at least two collected images');

  const lazy = images.find((img) => img.src.includes('lazy-hero.jpg'));
  assert.ok(lazy, 'srcset-only image should resolve its src to the srcset candidate');
  assert.equal(typeof lazy.naturalWidth, 'number');
  assert.equal(typeof lazy.naturalHeight, 'number');
  assert.equal(typeof lazy.top, 'number');
  assert.equal(typeof lazy.left, 'number');
  assert.ok('currentSrc' in lazy);
  assert.ok('loading' in lazy);

  const pictureImg = images.find((img) => img.src.includes('picture-candidate.jpg'));
  assert.ok(pictureImg, 'picture > source[srcset] image should resolve its src to the source candidate');
});

test('backgroundMedia captures css backgrounds and video posters, skipping svg data URIs', () => {
  assert.ok(Array.isArray(data.backgroundMedia));

  const cssBackgrounds = data.backgroundMedia.filter((m) => m.kind === 'css-background');
  assert.equal(cssBackgrounds.length, 1, 'only the raster background should be captured, not the svg data URI one');
  const [hero] = cssBackgrounds;
  assert.match(hero.src, /hero\.jpg$/);
  assert.equal(typeof hero.width, 'number');
  assert.equal(typeof hero.height, 'number');
  assert.equal(typeof hero.top, 'number');
  assert.equal(typeof hero.opacity, 'number');

  const posters = data.backgroundMedia.filter((m) => m.kind === 'video-poster');
  assert.equal(posters.length, 1);
  const [poster] = posters;
  assert.match(poster.src, /poster\.jpg$/);
  assert.equal(poster.tag, 'video');
  assert.equal(typeof poster.width, 'number');
  assert.equal(typeof poster.height, 'number');
  assert.equal(typeof poster.top, 'number');

  // A sizeable canvas is recorded as painted media (no pixels read); a tiny one is not.
  const canvases = data.backgroundMedia.filter((m) => m.kind === 'canvas');
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].width, 400);
  assert.equal(canvases[0].height, 300);
  assert.equal(canvases[0].src, '');
});

test('collectElements bounds total loop iterations regardless of skip-exempt element count', async () => {
  // Budget-exempt elements (script tags, svg descendants, head content) must
  // still count toward a hard iteration cap, or an attacker page padded with
  // millions of them makes the scan unbounded even though `collected` never
  // grows. maxElements=5 leaves room for the ambient <html>/<body> pushes
  // (2) without tripping the collected.length budget; padCount (55) exceeds
  // maxElements * 10 (50), so only the iteration cap — not the collected
  // budget — can be what stops the scan before the marker.
  const budgetPage = await browser.newPage();
  try {
    const maxElements = 5;
    const padCount = maxElements * 10 + 5;
    const scripts = '<script></script>'.repeat(padCount);
    await budgetPage.setContent(`<!DOCTYPE html><html><body>${scripts}<div id="late-marker">late</div></body></html>`);
    const result = await budgetPage.evaluate(collectPageData, { maxElements, ignoreSelectors: [], scopeSelector: null });
    const marker = result.computedStyles.find((e) => e.tag === 'div');
    assert.equal(marker, undefined, 'loop must stop before reaching elements placed after the skip-exempt padding');
  } finally {
    await budgetPage.close();
  }
});

test('collectElements shares one iteration budget across shadow-root recursion', async () => {
  // Each shadow host below pads its own shadow root with 45 skip-exempt
  // <template> elements — comfortably under the per-call cap (maxElements*10
  // = 50), so a *per-call* budget (a fresh `visited` local for every
  // recursive collectElements(shadowRoot, ...) call) never trips inside any
  // single shadow root and the scan sails through to the marker. Only a
  // budget shared across the whole call tree accumulates host0's ~4 ambient
  // visits + 45 (shadow0) + host1's visit + 45 (shadow1) past the 50 cap,
  // stopping the scan before the top-level loop ever reaches the marker.
  const budgetPage = await browser.newPage();
  try {
    const maxElements = 5;
    const padCount = 45;
    await budgetPage.setContent('<!DOCTYPE html><html><body></body></html>');
    await budgetPage.evaluate((count) => {
      for (let i = 0; i < 2; i++) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        for (let j = 0; j < count; j++) {
          shadow.appendChild(document.createElement('template'));
        }
      }
      const marker = document.createElement('div');
      marker.id = 'late-marker';
      document.body.appendChild(marker);
    }, padCount);
    const result = await budgetPage.evaluate(collectPageData, { maxElements, ignoreSelectors: [], scopeSelector: null });
    // Only the two shadow hosts are eligible top-level divs before the
    // marker; a shared budget must exhaust before the marker is reached.
    const divCount = result.computedStyles.filter((e) => e.tag === 'div').length;
    assert.ok(divCount <= 2, `expected the shared budget to stop the scan at or before the two shadow hosts, got ${divCount} divs collected`);
  } finally {
    await budgetPage.close();
  }
});
