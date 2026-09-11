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

test('scrollThroughPage calls onStep twice per step: early, then settled', async () => {
  const page = await openFixture();
  const seen = [];
  await scrollThroughPage(page, { maxSteps: 3, onStep: async (i, phase) => { seen.push([i, phase]); } });
  assert.deepEqual(seen, [[1, 'early'], [1, 'settled'], [2, 'early'], [2, 'settled'], [3, 'early'], [3, 'settled']]);
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

const revealFixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/scroll-reveal.html', import.meta.url)), 'utf8');

async function openRevealFixture() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(revealFixtureHtml);
  return page;
}

test('scrollThroughPage reads a reveal animation while it is still running, not just after it finishes', async () => {
  const page = await openRevealFixture();
  const readings = [];
  await scrollThroughPage(page, {
    onStep: async (step, phase) => {
      // animation-fill-mode: both keeps a FINISHED animation in
      // document.getAnimations() (playState 'finished'), so a bare count or
      // presence check passes on the settled read alone and never actually
      // exercises the early read. playState is the only signal that
      // distinguishes "still playing" from "already over".
      const r = await page.evaluate(() => ({
        anims: document.getAnimations().map((a) => ({
          playState: a.playState,
          top: Math.round(a.effect.target.getBoundingClientRect().top + window.scrollY),
        })),
      }));
      readings.push({ step, phase, ...r });
    },
  });
  await page.close();

  // Block 6 (0-indexed 5th section) spans document y [4000, 4800).
  const block6Top = 5 * 800;
  const block6Bottom = 6 * 800;
  const earlyRunning = readings.find((r) => r.phase === 'early'
    && r.anims.some((a) => a.playState === 'running' && a.top >= block6Top && a.top < block6Bottom));
  assert.ok(earlyRunning, `expected an 'early' reading with a RUNNING animation over block 6, got ${JSON.stringify(readings)}`);

  // A "no settled reading is still running" assertion was tried here too
  // (150ms settle + a networkidle wait "should" outlast the 400ms fadeUp),
  // but on this fixture Chromium's networkidle resolves near-instantly
  // (there is no other network activity to wait out), so a settled read can
  // still land mid-animation — confirmed flaky, see the fix report. Dropped
  // per the brief's own fallback; the early-running assertion above is the
  // one this test exists to prove and is not flaky.
});
