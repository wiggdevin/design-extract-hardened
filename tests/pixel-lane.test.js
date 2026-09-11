import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

import { createResponseLedger, selectPixelCandidates, collectPixelEvidence, LEDGER_LIMITS, PIXEL_LIMITS } from '../src/pixel-lane.js';
import { loadSharp } from '../src/extractors/pixel-features.js';

let sharp;
before(async () => { sharp = await loadSharp(); });

function noisePng(w = 400, h = 300, seed = 3) {
  const buf = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < buf.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; buf[i] = s >> 16; }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Minimal stand-in for a Playwright page: emits 'response' events.
class FakePage extends EventEmitter {
  off(event, fn) { return this.removeListener(event, fn); }
}
function fakeResponse(url, type, body) {
  return { url: () => url, headers: () => ({ 'content-type': type }), body: async () => body };
}

describe('createResponseLedger', () => {
  it('keeps raster image bodies the page received and ignores everything else', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    page.emit('response', fakeResponse('https://cdn.example.com/hero.jpg', 'image/jpeg', Buffer.from('jpg')));
    page.emit('response', fakeResponse('https://cdn.example.com/logo.svg', 'image/svg+xml', Buffer.from('<svg/>')));
    page.emit('response', fakeResponse('https://example.com/app.js', 'text/javascript', Buffer.from('js')));
    await ledger.settle();
    assert.equal(ledger.entries.size, 1);
    assert.ok(ledger.lookup('https://cdn.example.com/hero.jpg'));
    assert.equal(ledger.lookup('https://cdn.example.com/logo.svg'), null);
  });

  it('matches a collector-truncated source by prefix', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    const long = 'https://images.example.com/transform/0123456789abcdef0123456789abcdef/' + 'x'.repeat(200) + '?w=1280';
    page.emit('response', fakeResponse(long, 'image/webp', Buffer.from('webp')));
    await ledger.settle();
    assert.ok(ledger.lookup(long.slice(0, 120)));
    assert.equal(ledger.lookup('https://images.example.com/other'), null);
    assert.equal(ledger.lookup('data:image/png;base64,AAAA'), null);
  });

  it('is bounded by entry count, item size, and total size', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page, { maxEntries: 2, maxItemBytes: 10, maxTotalBytes: 15 });
    page.emit('response', fakeResponse('https://e.com/a.png', 'image/png', Buffer.alloc(8)));
    page.emit('response', fakeResponse('https://e.com/big.png', 'image/png', Buffer.alloc(11)));
    page.emit('response', fakeResponse('https://e.com/b.png', 'image/png', Buffer.alloc(8)));
    await ledger.settle();
    page.emit('response', fakeResponse('https://e.com/c.png', 'image/png', Buffer.alloc(1)));
    await ledger.settle();
    assert.deepEqual([...ledger.entries.keys()], ['https://e.com/a.png', 'https://e.com/c.png'], 'big exceeds the item cap, b would exceed the total, c fits');
    assert.equal(ledger.dropped, 2);
    assert.equal(ledger.bytes, 9);
    page.emit('response', fakeResponse('https://e.com/d.png', 'image/png', Buffer.alloc(1)));
    await ledger.settle();
    assert.equal(ledger.entries.size, 2, 'entry cap holds');
    ledger.stop();
    ledger.clear();
    assert.equal(ledger.entries.size, 0);
    assert.equal(ledger.bytes, 0);
  });

  it('settle() returns even when a response body never finishes (emmalewisham.co.uk stalled the crawl)', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    page.emit('response', { url: () => 'https://e.com/stalled.jpg', headers: () => ({ 'content-type': 'image/jpeg' }), body: () => new Promise(() => {}) });
    page.emit('response', fakeResponse('https://e.com/done.jpg', 'image/jpeg', Buffer.alloc(4)));
    const t0 = Date.now();
    await ledger.settle(200);
    assert.ok(Date.now() - t0 < 1000, 'settle must not wait for the stalled body');
    assert.ok(ledger.lookup('https://e.com/done.jpg'), 'finished bodies are still available');
    assert.equal(ledger.lookup('https://e.com/stalled.jpg'), null);
  });

  it('stop() detaches the listener so later responses are not read', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    ledger.stop();
    page.emit('response', fakeResponse('https://e.com/late.png', 'image/png', Buffer.alloc(4)));
    await ledger.settle();
    assert.equal(ledger.entries.size, 0);
  });

  it('refuses an oversized response by content-length before reading its body', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page, { maxEntries: 10, maxItemBytes: 100, maxTotalBytes: 1000 });
    let bodyReads = 0;
    page.emit('response', { url: () => 'https://e.com/huge.jpg', headers: () => ({ 'content-type': 'image/jpeg', 'content-length': '5000000' }), body: async () => { bodyReads++; return Buffer.alloc(10); } });
    page.emit('response', { url: () => 'https://e.com/fine.jpg', headers: () => ({ 'content-type': 'image/jpeg', 'content-length': '50' }), body: async () => { bodyReads++; return Buffer.alloc(50); } });
    await ledger.settle();
    assert.equal(bodyReads, 1, 'the oversized body is never read');
    assert.equal(ledger.dropped, 1);
    assert.ok(ledger.lookup('https://e.com/fine.jpg'));
  });

  it('default limits are the documented ones', () => {
    assert.equal(LEDGER_LIMITS.maxEntries, 300);
    assert.equal(LEDGER_LIMITS.maxItemBytes, 8 * 1024 * 1024);
    assert.equal(LEDGER_LIMITS.maxTotalBytes, 64 * 1024 * 1024);
  });
});

describe('selectPixelCandidates', () => {
  it('orders by visible area, skips svg, data URIs, hidden and small boxes, and caps the list', () => {
    const images = [
      { tag: 'img', src: 'https://e.com/hero.png', width: 1280, height: 700, top: 0, opacity: '1' },
      { tag: 'img', src: 'https://e.com/logo.svg', width: 600, height: 300, top: 0 },
      { tag: 'img', src: 'data:image/png;base64,AAAA', width: 800, height: 600, top: 0 },
      { tag: 'img', src: 'https://e.com/hidden.jpg', width: 900, height: 600, top: 0, opacity: '0' },
      { tag: 'img', src: 'https://e.com/tiny.png', width: 200, height: 100, top: 0 },
      { tag: 'svg', src: '', width: 800, height: 800, top: 0 },
      ...Array.from({ length: 12 }, (_, i) => ({ tag: 'img', src: `https://e.com/grid-${i}.png`, width: 400, height: 400, top: 900 })),
    ];
    const backgroundMedia = [
      { kind: 'canvas', src: '', width: 1280, height: 800, top: 0 },
      { kind: 'css-background', src: 'https://e.com/bg.jpg', width: 1280, height: 1232, top: 0 },
    ];
    const out = selectPixelCandidates({ images, backgroundMedia, viewport: { width: 1280, height: 800 }, baseUrl: 'https://e.com/' });
    assert.equal(out.length, PIXEL_LIMITS.maxCandidates);
    assert.equal(out[0].kind, 'canvas');
    assert.equal(out[1].kind, 'css-background');
    assert.equal(out[2].src, 'https://e.com/hero.png');
    assert.ok(out.every(c => !c.src.startsWith('data:') && !/\.svg$/.test(c.src)));
    assert.ok(out.every(c => c.src !== 'https://e.com/hidden.jpg' && c.src !== 'https://e.com/tiny.png'));
  });

  it('resolves relative sources against the page URL', () => {
    const out = selectPixelCandidates({ backgroundMedia: [{ kind: 'video-poster', src: '/assets/poster.png', width: 1280, height: 400, top: 0 }], baseUrl: 'https://e.com/x/' });
    assert.equal(out[0].absSrc, 'https://e.com/assets/poster.png');
  });

  it('tolerates malformed records', () => {
    assert.deepEqual(selectPixelCandidates({ images: [null, 1, {}], backgroundMedia: [undefined] }), []);
  });
});

describe('collectPixelEvidence', () => {
  it('classifies a ledger hit and persists numbers only', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    page.emit('response', fakeResponse('https://e.com/hero', 'image/png', await noisePng()));
    await ledger.settle();
    const candidates = selectPixelCandidates({ images: [{ tag: 'img', src: 'https://e.com/hero', width: 1280, height: 700, top: 0 }], baseUrl: 'https://e.com/' });
    const { evidence, summary } = await collectPixelEvidence({ ledger, candidates });
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].source, 'network');
    assert.equal(evidence[0].pixel.label, 'photography');
    assert.equal(summary.fromNetwork, 1);
    const json = JSON.stringify(evidence);
    assert.ok(json.length < 2000, 'evidence must be small numbers, not pixels');
    assert.ok(!('buf' in evidence[0]) && !('buffer' in evidence[0]));
  });

  it('reports a candidate the page never loaded as not-loaded, without fetching', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    const candidates = selectPixelCandidates({ images: [{ tag: 'img', src: 'https://e.com/never-loaded.jpg', width: 1000, height: 600, top: 0 }], baseUrl: 'https://e.com/' });
    const { evidence, summary } = await collectPixelEvidence({ ledger, candidates });
    assert.equal(evidence[0].source, 'not-loaded');
    assert.equal(evidence[0].pixel.label, 'unknown');
    assert.equal(summary.skipped, 1);
    assert.equal(summary.screenshots, 0);
  });

  it('stops analysing once the time budget is spent and marks the rest', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    page.emit('response', fakeResponse('https://e.com/a-very-long-source-name-for-prefix-matching/hero-one.png', 'image/png', await noisePng(600, 400)));
    page.emit('response', fakeResponse('https://e.com/a-very-long-source-name-for-prefix-matching/hero-two.png', 'image/png', await noisePng(600, 400)));
    await ledger.settle();
    const candidates = ['one', 'two'].map(n => ({ kind: 'img', src: `https://e.com/a-very-long-source-name-for-prefix-matching/hero-${n}.png`, absSrc: `https://e.com/a-very-long-source-name-for-prefix-matching/hero-${n}.png`, width: 1200, height: 800, weight: 1 }));
    const { evidence, summary } = await collectPixelEvidence({ ledger, candidates, limits: { ...PIXEL_LIMITS, totalBudgetMs: 0 } });
    assert.equal(evidence.length, 2, 'every candidate is still reported');
    assert.equal(evidence[1].source, 'budget-exhausted');
    assert.deepEqual(evidence[1].pixel.signals, ['pixel-budget-exhausted']);
    assert.ok(evidence.every(e => e.source === 'budget-exhausted' || e.pixel.label === 'photography'));
    assert.equal(summary.analysed + summary.skipped, 2);
    assert.ok(summary.skipped >= 1);
  });

  // A page stand-in for the composited path: evaluate() tags, locator()
  // screenshots. Records how many screenshots were taken.
  function fakeScreenshotPage(png) {
    const calls = { evaluate: 0, screenshots: 0 };
    return {
      calls,
      url: () => 'https://e.com/',
      evaluate: async (fn, arg) => { calls.evaluate++; return typeof arg === 'object' && arg && 'attr' in arg ? true : undefined; },
      locator: () => ({ first: () => ({ scrollIntoViewIfNeeded: async () => {}, screenshot: async () => { calls.screenshots++; return png; } }) }),
    };
  }

  it('canvases fall back to a composited screenshot, capped at maxScreenshots', async () => {
    const page = fakeScreenshotPage(await noisePng(400, 300));
    const candidates = Array.from({ length: 6 }, (_, i) => ({ kind: 'canvas', src: '', absSrc: '', width: 1280, height: 800, top: i * 900, weight: 1 }));
    const { evidence, summary } = await collectPixelEvidence({ page, ledger: null, candidates });
    assert.equal(summary.screenshots, PIXEL_LIMITS.maxScreenshots);
    assert.equal(page.calls.screenshots, PIXEL_LIMITS.maxScreenshots);
    assert.equal(evidence.filter(e => e.source === 'composited').length, PIXEL_LIMITS.maxScreenshots);
    assert.equal(evidence.filter(e => e.source === 'not-loaded').length, 6 - PIXEL_LIMITS.maxScreenshots);
    assert.ok(evidence.every(e => e.kind === 'canvas' && typeof e.top === 'number'));
  });

  it('a transparent glow layer from the ledger is replaced by the composited element (linear.app)', async () => {
    const w = 300, h = 300;
    const glow = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { glow[i * 4] = 255; glow[i * 4 + 3] = i % 9 === 0 ? 40 : 0; }
    const glowPng = await sharp(glow, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const fake = new FakePage();
    const ledger = createResponseLedger(fake);
    const src = 'https://e.com/imagedelivery/abcdefghijklmnopqrstuvwxyz0123456789/glow-layer/f=auto,fit=scale-down,w=2560';
    fake.emit('response', fakeResponse(src, 'image/webp', glowPng));
    await ledger.settle();
    const page = fakeScreenshotPage(await noisePng(400, 300));
    const { evidence, summary } = await collectPixelEvidence({ page, ledger, candidates: [{ kind: 'img', src, absSrc: src, width: 1920, height: 891, top: 0, weight: 1 }] });
    assert.equal(evidence[0].source, 'composited');
    assert.equal(summary.fromComposited, 1);
    assert.equal(summary.fromNetwork, 0);
    assert.equal(page.calls.screenshots, 1);
  });

  it('a transparent layer with no page to screenshot stays unknown and is never classified from its own bytes', async () => {
    const w = 300, h = 300;
    const glow = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { glow[i * 4] = 255; glow[i * 4 + 3] = i % 9 === 0 ? 40 : 0; }
    const glowPng = await sharp(glow, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const fake = new FakePage();
    const ledger = createResponseLedger(fake);
    const src = 'https://e.com/imagedelivery/abcdefghijklmnopqrstuvwxyz0123456789/glow-layer-two/f=auto,w=2560';
    fake.emit('response', fakeResponse(src, 'image/webp', glowPng));
    await ledger.settle();
    const { evidence, summary } = await collectPixelEvidence({ ledger, candidates: [{ kind: 'img', src, absSrc: src, width: 1920, height: 891, top: 0, weight: 1 }] });
    assert.equal(evidence[0].source, 'transparent-layer');
    assert.equal(evidence[0].pixel.label, 'unknown');
    assert.equal(evidence[0].features, undefined);
    assert.equal(summary.analysed, 0);
  });

  it('respects the candidate cap', async () => {
    const page = new FakePage();
    const ledger = createResponseLedger(page);
    const candidates = Array.from({ length: 20 }, (_, i) => ({ kind: 'img', src: `https://e.com/${i}.jpg`, absSrc: `https://e.com/${i}.jpg`, width: 800, height: 600, weight: 1 }));
    const { evidence } = await collectPixelEvidence({ ledger, candidates });
    assert.equal(evidence.length, PIXEL_LIMITS.maxCandidates);
  });
});
