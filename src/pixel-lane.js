// Pixel lane: turns the raster images a page already loaded into numeric
// evidence for media classification.
//
// Safety shape:
// - No URL is fetched that the page did not fetch. The ledger reads bodies
//   of responses Chromium already received through the safe browsing proxy.
// - Bytes stay inside crawlPage; only feature numbers and labels leave.
// - Everything is bounded: entries, bytes per image, total bytes,
//   candidates analysed, and composited screenshots taken.
import { pixelFeatures, classifyPixels, isTransparentLayer, loadSharp, MIN_DECISIVE_SIDE } from './extractors/pixel-features.js';

export const LEDGER_LIMITS = { maxEntries: 300, maxItemBytes: 8 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };
export const PIXEL_LIMITS = { maxCandidates: 8, maxScreenshots: 3, screenshotTimeoutMs: 5000, totalBudgetMs: 10000 };

// Records raster image bodies the page loads. Call before navigation.
export function createResponseLedger(page, limits = LEDGER_LIMITS) {
  const entries = new Map();
  let totalBytes = 0;
  let dropped = 0;
  const pending = new Set();
  const onResponse = (resp) => {
    let type = '';
    try { type = String(resp.headers()['content-type'] || '').toLowerCase(); } catch { return; }
    if (!type.startsWith('image/') || type.includes('svg')) return;
    if (entries.size >= limits.maxEntries) { dropped++; return; }
    // Content-length is advisory (absent on chunked responses), but when it
    // is present an oversized image is refused before its body is copied
    // into this process.
    let declared = NaN;
    try { declared = Number(resp.headers()['content-length']); } catch { declared = NaN; }
    if (Number.isFinite(declared) && declared > 0 && (declared > limits.maxItemBytes || totalBytes + declared > limits.maxTotalBytes)) { dropped++; return; }
    const p = resp.body().then((buf) => {
      if (!buf) return;
      if (buf.length > limits.maxItemBytes || totalBytes + buf.length > limits.maxTotalBytes) { dropped++; return; }
      const url = resp.url();
      if (entries.has(url)) return;
      entries.set(url, { buf, type });
      totalBytes += buf.length;
    }).catch(() => {}).finally(() => pending.delete(p));
    pending.add(p);
  };
  page.on('response', onResponse);
  return {
    entries,
    get bytes() { return totalBytes; },
    get dropped() { return dropped; },
    // Bodies resolve asynchronously; wait briefly for in-flight reads before
    // lookup. A body that never finishes (a stalled below-the-fold download)
    // must not hold the crawl, so the wait is bounded.
    settle: (timeoutMs = 1500) => Promise.race([
      Promise.all([...pending]),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]),
    stop: () => { page.off('response', onResponse); },
    clear: () => { entries.clear(); totalBytes = 0; },
    lookup(src) {
      if (!src || src.startsWith('data:')) return null;
      if (entries.has(src)) return { url: src, ...entries.get(src) };
      // Sources are capped at 500 chars in the collector; match on prefix.
      // A short prefix (an origin, a directory) would match anything.
      if (src.length < 40) return null;
      const prefix = src.slice(0, 120);
      for (const [url, entry] of entries) if (url.startsWith(prefix)) return { url, ...entry };
      return null;
    },
  };
}

function toAbsolute(src, base) {
  try { return new URL(src, base).href; } catch { return src; }
}

// Pick the raster candidates worth pixel analysis: the largest visible
// non-icon images and background media, skipping SVG, data: URIs, hidden
// and tiny boxes. Order is by visible area so a hero is always first.
export function selectPixelCandidates({ images = [], backgroundMedia = [], viewport = null, baseUrl = '' } = {}, max = PIXEL_LIMITS.maxCandidates) {
  const out = [];
  const seen = new Set();
  const push = (raw, kind) => {
    const width = Number(raw.width) || 0;
    const height = Number(raw.height) || 0;
    if (Math.max(width, height) < MIN_DECISIVE_SIDE) return;
    if (raw.opacity != null && Number(raw.opacity) === 0) return;
    const src = String(raw.src || raw.currentSrc || '');
    if (kind !== 'canvas') {
      if (!src || src.startsWith('data:')) return;
      if (/\.svg($|[?#])/i.test(src.split('#')[0])) return;
    }
    const top = typeof raw.top === 'number' && !Number.isNaN(raw.top) ? raw.top : null;
    const key = pixelEvidenceKey({ kind, src, width, height, top });
    if (seen.has(key)) return;
    seen.add(key);
    let fraction = 1;
    if (viewport && top != null && height) {
      const overlap = Math.max(0, Math.min(top + height, viewport.height) - Math.max(top, 0));
      fraction = overlap / height;
    }
    out.push({ kind, src: src.slice(0, 500), absSrc: toAbsolute(src, baseUrl), width, height, top, weight: width * height * fraction });
  };
  for (const img of images) if (img && typeof img === 'object' && img.tag !== 'svg') push(img, 'img');
  for (const bg of backgroundMedia) if (bg && typeof bg === 'object') push(bg, bg.kind || 'css-background');
  return out.sort((a, b) => b.weight - a.weight).slice(0, max);
}

// Runs in the page: tag the element behind one candidate so it can be
// screenshotted. Only used as a fallback (canvas, or a transparent layer).
function tagElementInPage({ kind, src, width, height, attr }) {
  const prefix = (src || '').slice(0, 120);
  const rectOf = (el) => el.getBoundingClientRect();
  const visible = (el) => { const r = rectOf(el); const cs = getComputedStyle(el); return r.width >= 5 && r.height >= 5 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sizeScore = (r) => Math.abs(r.width - width) + Math.abs(r.height - height);
  let pool = [];
  if (kind === 'canvas') pool = [...document.querySelectorAll('canvas')].filter(visible);
  else if (kind === 'img') pool = [...document.querySelectorAll('img')].filter(el => (el.currentSrc || el.src || '').startsWith(prefix)).filter(visible);
  else if (kind === 'css-background') pool = [...document.querySelectorAll('*')].filter(el => { const bg = getComputedStyle(el).backgroundImage; return bg && bg.includes(prefix.slice(0, 80)); }).filter(visible);
  else if (kind === 'video-poster') pool = [...document.querySelectorAll('video[poster]')].filter(el => { try { return new URL(el.getAttribute('poster'), location.href).href.startsWith(new URL(prefix, location.href).href); } catch { return false; } }).filter(visible);
  if (!pool.length) return false;
  pool.sort((a, b) => sizeScore(rectOf(a)) - sizeScore(rectOf(b)));
  for (const el of document.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  pool[0].setAttribute(attr, '1');
  return true;
}

const TAG_ATTR = 'data-designlang-pixel';

async function compositedCrop(page, candidate, timeoutMs) {
  const tagged = await page.evaluate(tagElementInPage, { kind: candidate.kind, src: candidate.src, width: candidate.width, height: candidate.height, attr: TAG_ATTR });
  if (!tagged) return null;
  const handle = page.locator(`[${TAG_ATTR}]`).first();
  try {
    await handle.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => {});
    return await handle.screenshot({ timeout: timeoutMs, animations: 'allow' });
  } finally {
    // The marker must not survive a failed screenshot either: later
    // extractors read the DOM after this lane runs.
    await page.evaluate((attr) => { for (const el of document.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr); }, TAG_ATTR).catch(() => {});
  }
}

// Produces the persisted evidence list. `page` may be null (no screenshot
// fallback, e.g. in tests); `ledger` may be null (screenshots only).
export async function collectPixelEvidence({ page = null, ledger = null, candidates = [], limits = PIXEL_LIMITS } = {}) {
  const sharp = await loadSharp();
  const evidence = [];
  const summary = { analysed: 0, fromNetwork: 0, fromComposited: 0, screenshots: 0, skipped: 0, unavailable: sharp.unavailable || null, ms: 0 };
  if (sharp.unavailable) return { evidence, summary };
  const t0 = Date.now();
  if (ledger) await ledger.settle();
  let screenshots = 0;
  for (const c of candidates.slice(0, limits.maxCandidates)) {
    // The lane is an enrichment; past its time budget the rest stay unknown.
    if (Date.now() - t0 > (limits.totalBudgetMs ?? PIXEL_LIMITS.totalBudgetMs)) {
      summary.skipped++;
      evidence.push({ kind: c.kind, src: c.src.slice(0, 500), width: c.width, height: c.height, top: c.top ?? null, source: 'budget-exhausted', pixel: { label: 'unknown', confidence: 0, signals: ['pixel-budget-exhausted'] } });
      continue;
    }
    let buf = null;
    let source = null;
    const hit = ledger && c.kind !== 'canvas' ? (ledger.lookup(c.absSrc) || ledger.lookup(c.src)) : null;
    if (hit) {
      try {
        if (await isTransparentLayer(hit.buf)) source = 'transparent-layer';
        else { buf = hit.buf; source = 'network'; }
      } catch { source = 'undecodable'; }
    }
    if (!buf && page && screenshots < limits.maxScreenshots && (c.kind === 'canvas' || source === 'transparent-layer' || !hit)) {
      screenshots++;
      try {
        buf = await compositedCrop(page, c, limits.screenshotTimeoutMs);
        if (buf) source = 'composited';
      } catch { buf = null; }
    }
    const ident = { kind: c.kind, src: c.src.slice(0, 500), width: c.width, height: c.height, top: c.top ?? null };
    if (!buf) { summary.skipped++; evidence.push({ ...ident, source: source || 'not-loaded', pixel: { label: 'unknown', confidence: 0, signals: ['no-pixels'] } }); continue; }
    try {
      const features = await pixelFeatures(buf);
      const pixel = classifyPixels(features, { kind: c.kind, width: c.width, height: c.height });
      summary.analysed++;
      if (source === 'network') summary.fromNetwork++; else summary.fromComposited++;
      evidence.push({ ...ident, source, features, pixel });
    } catch (err) {
      summary.skipped++;
      evidence.push({ ...ident, source, pixel: { label: 'unknown', confidence: 0, signals: [`pixel-error: ${String(err?.message || err).slice(0, 80)}`] } });
    }
  }
  summary.screenshots = screenshots;
  summary.ms = Date.now() - t0;
  return { evidence, summary };
}

// Key used by media-system to join evidence to a candidate record. Source,
// box, and position together: two same-size canvases, or two images whose
// CDN URLs share a long prefix, must never share one verdict.
export function pixelEvidenceKey({ kind = 'img', src = '', width = 0, height = 0, top = null } = {}) {
  const pos = top == null || Number.isNaN(Number(top)) ? '' : Math.round(Number(top));
  return `${kind}|${String(src || '').slice(0, 500)}|${Math.round(Number(width) || 0)}x${Math.round(Number(height) || 0)}|${pos}`;
}
