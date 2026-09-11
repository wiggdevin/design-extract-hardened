// Pixel features for media classification.
//
// Input is an in-memory image buffer the page itself loaded (or a composited
// element screenshot). Output is a small numeric record: no pixels and no
// bytes, so it is safe to persist in extraction output. Sharp is loaded
// lazily; when the native module is unavailable the lane reports why and
// the DOM-only result stands.

const ANALYSIS_SIDE = 192;

let sharpPromise = null;
export function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp').then(m => m.default || m).catch(err => {
      const reason = String(err?.message || err).slice(0, 120);
      return { unavailable: reason };
    });
  }
  return sharpPromise;
}

function quantKey(r, g, b) {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
}

// Mean alpha below half means the image is a glow, mask, or shadow layer
// (linear.app stacks several over a dark background). Its own pixels say
// nothing about what the page shows.
export async function isTransparentLayer(buffer) {
  const sharp = await loadSharp();
  if (sharp.unavailable) return false;
  const meta = await sharp(buffer).metadata();
  if (!meta.hasAlpha) return false;
  const stats = await sharp(buffer).stats();
  const alpha = stats.channels[stats.channels.length - 1];
  return Boolean(alpha) && alpha.mean < 128;
}

export async function pixelFeatures(buffer) {
  const sharp = await loadSharp();
  if (sharp.unavailable) return null;
  const stats = await sharp(buffer).stats();
  const { data, info } = await sharp(buffer)
    .resize({ width: ANALYSIS_SIDE, height: ANALYSIS_SIDE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  if (!n) return null;

  const exact = new Set();
  const quant = new Map();
  let transparent = 0;
  let flatPairs = 0;
  let pairs = 0;
  let satSum = 0;
  let strongEdges = 0;
  let axisEdges = 0;
  const gray = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 250) transparent++;
      exact.add((r << 16) | (g << 8) | b);
      const q = quantKey(r, g, b);
      quant.set(q, (quant.get(q) || 0) + 1);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      satSum += max ? (max - min) / max : 0;
      gray[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (x + 1 < w) {
        pairs++;
        const j = i + 4;
        if (Math.abs(data[j] - r) <= 2 && Math.abs(data[j + 1] - g) <= 2 && Math.abs(data[j + 2] - b) <= 2) flatPairs++;
      }
      if (y + 1 < h) {
        pairs++;
        const j = i + w * 4;
        if (Math.abs(data[j] - r) <= 2 && Math.abs(data[j + 1] - g) <= 2 && Math.abs(data[j + 2] - b) <= 2) flatPairs++;
      }
    }
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = gray[y * w + x + 1] - gray[y * w + x - 1];
      const gy = gray[(y + 1) * w + x] - gray[(y - 1) * w + x];
      const mag = Math.hypot(gx, gy);
      if (mag < 40) continue;
      strongEdges++;
      const ax = Math.abs(gx), ay = Math.abs(gy);
      if (ax > 4 * ay || ay > 4 * ax) axisEdges++;
    }
  }

  const bins = [...quant.values()].sort((a, b) => b - a);
  const top8 = bins.slice(0, 8).reduce((s, v) => s + v, 0) / n;
  const lum = stats.channels.slice(0, 3);
  const meanStdev = lum.reduce((s, c) => s + c.stdev, 0) / lum.length;
  const interior = Math.max(1, (w - 2) * (h - 2));

  return {
    width: w,
    height: h,
    entropy: Number(stats.entropy.toFixed(3)),
    sharpness: Number(stats.sharpness.toFixed(3)),
    stdev: Number(meanStdev.toFixed(2)),
    uniqueRatio: Number((exact.size / n).toFixed(4)),
    flatShare: Number((flatPairs / Math.max(1, pairs)).toFixed(4)),
    top8Share: Number(top8.toFixed(4)),
    edgeDensity: Number((strongEdges / interior).toFixed(4)),
    axisEdgeShare: Number((strongEdges ? axisEdges / strongEdges : 0).toFixed(4)),
    saturation: Number((satSum / n).toFixed(4)),
    transparentShare: Number((transparent / n).toFixed(4)),
  };
}

// Bands measured on 43 crops from 16 sites (benchmarks/pixel-bakeoff-2026-09-10.md):
// photographs scored entropy 6.25 to 7.85; renders, screenshots, and logos
// scored 0.25 to 4.8; one gradient hero sat at 5.9. The gap between 5.0 and
// 6.2 is left `unknown`. A product render on a white sweep also reads as
// flat, so pixel labels only resolve candidates the DOM could not label;
// they never override a DOM label.
export const PHOTO_MIN_ENTROPY = 6.2;
export const RENDER_MAX_ENTROPY = 5.0;
export const MIN_DECISIVE_SIDE = 300;

export function classifyPixels(f, { kind = 'img', width = 0, height = 0 } = {}) {
  if (!f) return { label: 'unknown', confidence: 0, signals: ['no-pixels'] };
  if (Math.max(width, height) > 0 && Math.max(width, height) < MIN_DECISIVE_SIDE) {
    return { label: 'unknown', confidence: 0, signals: ['pixel-small'] };
  }
  if (f.entropy >= PHOTO_MIN_ENTROPY && f.uniqueRatio >= 0.08) {
    return { label: 'photography', confidence: f.entropy >= 7 ? 0.9 : 0.8, signals: ['pixel-photo-like'] };
  }
  if (f.entropy < RENDER_MAX_ENTROPY && f.flatShare >= 0.6) {
    if (kind === 'canvas') return { label: '3d-render', confidence: 0.6, signals: ['pixel-flat-canvas'] };
    // A screenshot is never mostly transparent; flat art on transparency is.
    if (f.transparentShare >= 0.2) return { label: 'illustration', confidence: 0.5, signals: ['pixel-flat-transparent'] };
    if (f.axisEdgeShare >= 0.6 && f.edgeDensity >= 0.03) return { label: 'ui-screenshot', confidence: 0.7, signals: ['pixel-flat-axis-aligned'] };
    return { label: 'illustration', confidence: 0.4, signals: ['pixel-flat'] };
  }
  return { label: 'unknown', confidence: 0, signals: ['pixel-ambiguous'] };
}
