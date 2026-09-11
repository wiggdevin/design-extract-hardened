import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { scrollThroughPage, waitForImages } from '../src/crawler.js';

const fixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/scroll-capture.html', import.meta.url)), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

async function openFixture() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setContent(fixtureHtml);
  return page;
}

const loadedCount = (page) => page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0).length);

test('lazy images far down the page are not loaded before the pass', async () => {
  const page = await openFixture();
  const before = await loadedCount(page);
  assert.ok(before < 30, `expected some lazy images to be pending, got ${before}/30 loaded`);
  await page.close();
});

test('scrollThroughPage steps by viewport height and every image completes', async () => {
  const page = await openFixture();
  const scroll = await scrollThroughPage(page);
  const images = await waitForImages(page);
  assert.equal(scroll.steps, 30);
  assert.equal(scroll.capped, false);
  assert.ok(scroll.pageHeightPx >= 24000, `pageHeightPx ${scroll.pageHeightPx}`);
  assert.equal(scroll.coveredPx, scroll.pageHeightPx);
  assert.equal(images.total, 30);
  assert.equal(images.incomplete, 0);
  assert.equal(await loadedCount(page), 30);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'the pass returns to the top');
  await page.close();
});

test('scrollThroughPage honours the step cap and reports what it covered', async () => {
  const page = await openFixture();
  const scroll = await scrollThroughPage(page, { maxSteps: 5 });
  assert.equal(scroll.steps, 5);
  assert.equal(scroll.capped, true);
  assert.equal(scroll.coveredPx, 6 * 800);
  await page.close();
});

test('scrollThroughPage calls onStep once per step with the step index', async () => {
  const page = await openFixture();
  const seen = [];
  await scrollThroughPage(page, { maxSteps: 3, onStep: async (i) => { seen.push(i); } });
  assert.deepEqual(seen, [1, 2, 3]);
  await page.close();
});

test('scrollThroughPage reports scroller: window on an ordinary page', async () => {
  const page = await openFixture();
  const scroll = await scrollThroughPage(page);
  assert.equal(scroll.scroller, 'window');
  await page.close();
});

const innerFixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/scroll-inner-container.html', import.meta.url)), 'utf8');

async function openInnerFixture() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setContent(innerFixtureHtml);
  return page;
}

test('scrollThroughPage finds pageHeight and scrolls an inner scroll container', async () => {
  const page = await openInnerFixture();
  const scroll = await scrollThroughPage(page);
  const images = await waitForImages(page);
  assert.ok(scroll.pageHeightPx >= 16000, `pageHeightPx ${scroll.pageHeightPx}`);
  assert.ok(scroll.steps >= 19, `steps ${scroll.steps}`);
  assert.equal(scroll.scroller, 'element');
  assert.equal(images.incomplete, 0);
  const lastComplete = await page.evaluate(() => {
    const imgs = document.images;
    const last = imgs[imgs.length - 1];
    return !!last && last.complete && last.naturalWidth > 0;
  });
  assert.ok(lastComplete, 'the last lazy image inside the inner scroller finished loading');
  await page.close();
});
