import { describe, it, before } from 'node:test';
import assert from 'node:assert';

import { pixelFeatures, classifyPixels, isTransparentLayer, loadSharp, PHOTO_MIN_ENTROPY, RENDER_MAX_ENTROPY, MIN_DECISIVE_SIDE } from '../src/extractors/pixel-features.js';

// Synthetic images built with Sharp itself, so the tests need no fixtures.
let sharp;
before(async () => { sharp = await loadSharp(); });

// Deterministic pseudo-random bytes (LCG) — a photograph-like noise field.
function noiseRgb(w, h, seed = 7) {
  const buf = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < buf.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; buf[i] = s >> 16; }
  return buf;
}

async function noisePng(w = 400, h = 300) {
  return sharp(noiseRgb(w, h), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Flat panels with axis-aligned 1px separators: the shape of a UI screenshot.
async function uiPng(w = 480, h = 320) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const panel = x < 160 ? 40 : 250;
      const line = y % 32 === 0 || x % 80 === 0;
      const v = line ? 120 : panel;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// A flat logo on a transparent background.
async function logoPng(w = 400, h = 200) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x > 100 && x < 300 && y > 60 && y < 140;
      buf[i] = 20; buf[i + 1] = 90; buf[i + 2] = 200; buf[i + 3] = inside ? 255 : 0;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// A faint glow layer: alpha mostly near zero.
async function glowPng(w = 300, h = 300) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { buf[i * 4] = 255; buf[i * 4 + 1] = 0; buf[i * 4 + 2] = 255; buf[i * 4 + 3] = i % 7 === 0 ? 60 : 0; }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe('pixelFeatures', () => {
  it('a noise field scores in the photograph band', async () => {
    const f = await pixelFeatures(await noisePng());
    assert.ok(f.entropy >= PHOTO_MIN_ENTROPY, `entropy ${f.entropy}`);
    assert.ok(f.uniqueRatio > 0.5, `uniqueRatio ${f.uniqueRatio}`);
    assert.ok(f.flatShare < 0.1, `flatShare ${f.flatShare}`);
    assert.equal(f.transparentShare, 0);
  });

  it('flat panels with axis-aligned lines score in the render band', async () => {
    const f = await pixelFeatures(await uiPng());
    assert.ok(f.entropy < RENDER_MAX_ENTROPY, `entropy ${f.entropy}`);
    assert.ok(f.flatShare >= 0.6, `flatShare ${f.flatShare}`);
    assert.ok(f.axisEdgeShare >= 0.6, `axisEdgeShare ${f.axisEdgeShare}`);
    assert.ok(f.edgeDensity >= 0.03, `edgeDensity ${f.edgeDensity}`);
  });

  it('returns numbers only, never pixel data', async () => {
    const f = await pixelFeatures(await noisePng(64, 64));
    for (const [k, v] of Object.entries(f)) assert.equal(typeof v, 'number', `${k} is ${typeof v}`);
    assert.ok(!('data' in f) && !('buffer' in f));
  });

  it('analysis is bounded to a small working size', async () => {
    const f = await pixelFeatures(await noisePng(2000, 1200));
    assert.ok(f.width <= 192 && f.height <= 192, `${f.width}x${f.height}`);
  });
});

describe('isTransparentLayer', () => {
  it('flags a mostly transparent glow layer', async () => {
    assert.equal(await isTransparentLayer(await glowPng()), true);
  });
  it('does not flag an opaque image or a logo with a solid mark', async () => {
    assert.equal(await isTransparentLayer(await noisePng(64, 64)), false);
  });
});

describe('classifyPixels', () => {
  it('photograph band -> photography', async () => {
    const f = await pixelFeatures(await noisePng());
    const r = classifyPixels(f, { kind: 'img', width: 1280, height: 720 });
    assert.equal(r.label, 'photography');
    assert.ok(r.confidence >= 0.8);
    assert.deepEqual(r.signals, ['pixel-photo-like']);
  });

  it('render band with axis-aligned edges -> ui-screenshot for an <img>, 3d-render for a canvas', async () => {
    const f = await pixelFeatures(await uiPng());
    assert.equal(classifyPixels(f, { kind: 'img', width: 1280, height: 720 }).label, 'ui-screenshot');
    assert.equal(classifyPixels(f, { kind: 'video-poster', width: 1280, height: 400 }).label, 'ui-screenshot');
    assert.equal(classifyPixels(f, { kind: 'canvas', width: 1280, height: 800 }).label, '3d-render');
  });

  it('flat art on transparency -> illustration', async () => {
    const f = await pixelFeatures(await logoPng());
    const r = classifyPixels(f, { kind: 'img', width: 400, height: 200 });
    assert.equal(r.label, 'illustration');
    assert.ok(r.signals.includes('pixel-flat-transparent'));
  });

  it('small boxes stay unknown even with decisive pixels', async () => {
    const f = await pixelFeatures(await noisePng());
    const r = classifyPixels(f, { kind: 'img', width: MIN_DECISIVE_SIDE - 1, height: 40 });
    assert.equal(r.label, 'unknown');
    assert.deepEqual(r.signals, ['pixel-small']);
  });

  it('the gap between the bands is unknown with a named signal', () => {
    const r = classifyPixels({ entropy: 5.6, uniqueRatio: 0.3, flatShare: 0.5, axisEdgeShare: 0.5, edgeDensity: 0.1, transparentShare: 0 }, { kind: 'img', width: 1000, height: 600 });
    assert.equal(r.label, 'unknown');
    assert.deepEqual(r.signals, ['pixel-ambiguous']);
  });

  it('null features -> unknown', () => {
    assert.equal(classifyPixels(null).label, 'unknown');
  });
});
