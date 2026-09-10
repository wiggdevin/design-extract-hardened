// Classify a page's dominant media type by VISIBLE WEIGHT rather than by
// counting <img> tags. A single full-bleed hero photo should outrank a grid
// of 40 nav icons; a hidden (opacity:0) hero should not vote at all. This
// replaces count-driven imagery classification for crawls rich enough to
// carry layout evidence (position, natural size, background media).

const ICON_MAX_SIDE = 48;
const ICON_MIN_AREA = 2500;

const THREE_D_RE = /\b(3d|render|gltf|glb|iso)\b/;
const PRODUCT_RE = /\b(product|shop|sku)\b/;
const SCREENSHOT_RE = /\b(screenshot|dashboard|app|ui|product-ui)\b/;
const ILLUSTRATION_RE = /\b(illustr|character|mascot)\b/;

function toNum(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

function isSvgSrc(src) {
  const s = (src || '').toLowerCase();
  return s.endsWith('.svg') || s.startsWith('data:image/svg+xml');
}

function pathExt(path) {
  const clean = (path || '').toLowerCase().split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
}

// Image proxies (Next.js /_next/image?url=..., imgix/Cloudinary fetch URLs)
// hide the original extension inside a query parameter. Recovering it is
// deterministic evidence, not a guess.
const PROXY_PARAMS = ['url', 'src', 'image', 'u', 'img'];
function extOf(src) {
  const direct = pathExt(src);
  if (direct) return direct;
  const q = (src || '').indexOf('?');
  if (q === -1) return null;
  let params;
  try { params = new URLSearchParams((src || '').slice(q + 1, q + 2001)); } catch { return null; }
  for (const key of PROXY_PARAMS) {
    const v = params.get(key);
    if (!v) continue;
    let decoded = v;
    try { decoded = decodeURIComponent(v); } catch { /* keep raw */ }
    const ext = pathExt(decoded);
    if (ext) return ext;
  }
  return null;
}

function isDataUri(src) {
  return (src || '').toLowerCase().startsWith('data:');
}

// Fraction of the candidate's vertical extent that falls inside the
// viewport, so a below-fold duplicate of the same hero weighs less.
function viewportFraction(top, height, viewport) {
  if (typeof top !== 'number' || !viewport || typeof viewport.height !== 'number' || !height) return 1;
  const overlap = Math.max(0, Math.min(top + height, viewport.height) - Math.max(top, 0));
  return overlap / height;
}

function buildCandidate(raw, viewport, isBackground) {
  // Clamp negative dimensions to 0 (a corrupted/mirrored-transform read):
  // two negatives would otherwise multiply into a large positive weight
  // while still tripping the icon-size check, since any negative number is
  // < ICON_MAX_SIDE. Clamping to 0 routes it through the existing `hidden`
  // check instead.
  const width = Math.max(0, toNum(raw.width) || 0);
  const height = Math.max(0, toNum(raw.height) || 0);
  const opacity = typeof raw.opacity === 'number' ? raw.opacity : 1;
  const top = toNum(raw.top);
  const hidden = opacity === 0 || width === 0 || height === 0;
  const fraction = hidden ? 0 : viewportFraction(top, height, viewport);
  const kind = isBackground ? (raw.kind || 'css-background') : (raw.tag === 'svg' ? 'svg' : 'img');
  // A non-SVG data: URI is a blur-up placeholder (the crawler caps src at
  // 500 chars, so a real inlined image cannot be told apart from one), and
  // a placeholder must not vote for or against anything.
  const src = raw.src || raw.currentSrc || '';
  // url(#filter) references are SVG paint servers, not images (mercury.com's
  // largest "background" was `url(#n)`).
  const fragmentRef = /^(#|%23)/.test(src);
  const placeholder = (isDataUri(src) && !isSvgSrc(src)) || fragmentRef;
  const computedWeight = hidden || placeholder ? 0 : width * height * fraction * opacity;
  // An oversized-but-individually-finite dimension can overflow width*height
  // to Infinity; guard so one poisoned candidate can't turn every downstream
  // ratio (share/coverage/confidence) into NaN/null. Drop it from voting.
  const weight = Number.isFinite(computedWeight) ? computedWeight : 0;
  return { raw, kind, width, height, weight, placeholder };
}

function hintText(candidate) {
  const raw = candidate.raw;
  return [raw.classList, raw.src, raw.currentSrc, raw.alt].filter(Boolean).join(' ').toLowerCase();
}

// Deterministic label + a per-candidate confidence multiplier for cases
// (extensionless src) where the label is inferred rather than read off the
// URL — that multiplier discounts the candidate's contribution to coverage,
// never its share of the visible-weight distribution.
function classifyCandidate(candidate) {
  const src = candidate.raw.src || candidate.raw.currentSrc || '';
  const text = hintText(candidate);
  const maxSide = Math.max(candidate.width, candidate.height);

  if (candidate.kind === 'svg' || isSvgSrc(src)) {
    return { label: maxSide >= 100 ? 'illustration' : 'iconography', signals: [], confidenceMul: 1 };
  }
  // A poster frame is classified like any image by its source; hyperliquid.xyz
  // posters a rendered PNG, not a photograph.
  if (candidate.kind === 'video-poster') {
    const posterExt = extOf(src);
    if (posterExt && ['jpg', 'jpeg', 'webp', 'avif'].includes(posterExt)) return { label: 'photography', signals: [], confidenceMul: 1 };
    return { label: 'unknown', signals: ['poster-ambiguous'], confidenceMul: 1 };
  }
  // A canvas paints WebGL scenes, charts, or video frames; without pixels
  // the DOM cannot say which. spline.design's hero is three of these.
  if (candidate.kind === 'canvas') {
    return { label: 'unknown', signals: ['canvas-rendered'], confidenceMul: 1 };
  }
  if (THREE_D_RE.test(text)) {
    return { label: '3d-render', signals: [], confidenceMul: 1 };
  }

  const ext = extOf(src);
  if (ext && ['jpg', 'jpeg', 'webp', 'avif'].includes(ext)) {
    const product = candidate.raw.objectFit === 'contain' || PRODUCT_RE.test(text);
    return { label: product ? 'product-photography' : 'photography', signals: [], confidenceMul: 1 };
  }
  if (ext === 'png') {
    if (SCREENSHOT_RE.test(text)) return { label: 'ui-screenshot', signals: [], confidenceMul: 1 };
    if (ILLUSTRATION_RE.test(text)) return { label: 'illustration', signals: [], confidenceMul: 1 };
    // A large PNG is a photo on liveaevi.com and a screenshot on linear.app;
    // the container and size cannot tell them apart. Say so.
    return { label: 'unknown', signals: ['png-ambiguous'], confidenceMul: 1 };
  }
  if (ext === 'gif') return { label: 'unknown', signals: ['gif-ambiguous'], confidenceMul: 1 };

  // Extensionless or blank src with no recoverable original: the natural
  // size proves a raster loaded, not what it depicts. linear.app (screenshots)
  // and n26.com (photos) look identical here.
  const nw = toNum(candidate.raw.naturalWidth);
  const nh = toNum(candidate.raw.naturalHeight);
  if (nw && nh && Math.max(nw, nh) >= 300) {
    return { label: 'unknown', signals: ['extensionless-source'], confidenceMul: 1 };
  }
  return { label: 'unknown', signals: [], confidenceMul: 1 };
}

const PHOTO_FAMILY = new Set(['photography', 'product-photography']);

function emptyResult(label) {
  return { label, confidence: 0, distribution: [], dominantMedia: [], coverage: 0, signals: [], alternatives: [] };
}

export function extractMediaSystem({ images = [], backgroundMedia = [], viewport = null } = {}) {
  // Default params only cover `undefined`; an explicit null (or a malformed
  // element inside either array — a css-background/video-poster capture
  // that failed on one node) must degrade to "skip it", not throw, so one
  // bad record can never wipe an otherwise-good result via an outer catch.
  const safeImages = Array.isArray(images) ? images : [];
  const safeBackgroundMedia = Array.isArray(backgroundMedia) ? backgroundMedia : [];
  const raw = [
    ...safeImages.filter(img => img && typeof img === 'object').map(img => buildCandidate(img, viewport, false)),
    ...safeBackgroundMedia.filter(bg => bg && typeof bg === 'object').map(bg => buildCandidate(bg, viewport, true)),
  ];
  const placeholders = raw.filter(c => c.placeholder).length;
  const voting = raw.filter(c => c.weight > 0);
  if (!voting.length) {
    const empty = emptyResult('none');
    if (placeholders) empty.signals.push(`${placeholders} data-uri placeholders excluded`);
    return empty;
  }

  const isIcon = c => Math.max(c.width, c.height) < ICON_MAX_SIDE || c.width * c.height < ICON_MIN_AREA;
  const nonIcon = voting.filter(c => !isIcon(c));
  const forcedIconography = nonIcon.length === 0;
  const effective = forcedIconography ? voting : nonIcon;

  // When only icon-sized media exists, the page's imagery IS its icons, so
  // the distribution must say so instead of "unknown" for blank-src glyphs.
  const classified = effective.map(c => {
    const cls = classifyCandidate(c);
    if (forcedIconography && cls.label === 'unknown') return { ...c, ...cls, label: 'iconography' };
    return { ...c, ...cls };
  });
  const totalWeight = classified.reduce((s, c) => s + c.weight, 0);

  const byLabel = new Map();
  for (const c of classified) {
    const entry = byLabel.get(c.label) || { weight: 0, count: 0 };
    entry.weight += c.weight;
    entry.count += 1;
    byLabel.set(c.label, entry);
  }
  const distribution = [...byLabel.entries()]
    .map(([label, { weight, count }]) => ({
      label,
      share: totalWeight ? Number((weight / totalWeight).toFixed(3)) : 0,
      weight: Math.round(weight),
      count,
    }))
    .sort((a, b) => b.share - a.share);

  const top = distribution[0];
  const second = distribution[1];
  // photography and product-photography are one family for the margin
  // test: a store whose hero is a scene and whose grid is product shots is
  // photography-led, not "mixed".
  const sameFamily = second && PHOTO_FAMILY.has(top.label) && PHOTO_FAMILY.has(second.label);
  const rival = sameFamily ? distribution[2] : second;
  const familyShare = sameFamily ? top.share + second.share : top.share;
  let label;
  if (forcedIconography) label = 'iconography';
  else if (familyShare >= 0.5 && familyShare - (rival ? rival.share : 0) >= 0.15) label = top.label;
  else label = 'mixed';
  // An unknown-heavy page overrides even a technically-passing top share.
  const unknownShare = (byLabel.get('unknown')?.weight || 0) / (totalWeight || 1);
  if (!forcedIconography && unknownShare > 0.5) label = 'unknown';

  const classifiedWeight = classified.reduce((s, c) => s + (c.label !== 'unknown' ? c.weight * c.confidenceMul : 0), 0);
  const coverage = totalWeight ? Number((classifiedWeight / totalWeight).toFixed(3)) : 0;
  const confidence = Math.max(0, Math.min(1, Number(((top.share) * (0.5 + 0.5 * coverage)).toFixed(3))));

  const dominantMedia = classified
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(c => ({
      kind: c.kind,
      src: (c.raw.src || c.raw.currentSrc || '').slice(0, 120),
      label: c.label,
      weight: Math.round(c.weight),
      width: c.width,
      height: c.height,
    }));

  const signals = [...new Set(classified.flatMap(c => c.signals))];
  if (placeholders) signals.push(`${placeholders} data-uri placeholders excluded`);

  const alternatives = distribution
    .filter(d => d.label !== label)
    .slice(0, 3)
    .map(d => ({ value: d.label, score: d.share, reason: `${Math.round(d.share * 100)}% of visible weight` }));

  return { label, confidence, distribution, dominantMedia, coverage, signals, alternatives };
}
