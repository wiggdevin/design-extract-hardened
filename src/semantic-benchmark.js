// Semantic ground-truth loader + scorer for the human-reviewed benchmark set.
// Pure functions only — no file I/O, no network. Callers own reading the JSON
// and picking which extractor output to compare it against.

const VALID_CAPTURE_STATUS = new Set(['reviewed', 'unscored', 'changed', 'blocked']);
const VALID_GLOBAL_GEOMETRY = new Set(['square', 'rounded', 'pill', 'mixed']);
const VALID_ROLE_GEOMETRY = new Set(['square', 'rounded', 'pill', 'circle']);
const VALID_MEDIA_LABELS = new Set([
  'photography', 'product-photography', 'ui-screenshot', 'illustration',
  '3d-render', 'logo', 'iconography', 'gradient-texture', 'none', 'unknown',
]);

// Older extractor output used a different label vocabulary; map it forward
// so the benchmark can score current and recently-current extractions alike.
const LEGACY_MEDIA_LABELS = {
  'flat-illustration': 'illustration',
  'icon-only': 'iconography',
  screenshot: 'ui-screenshot',
  'gradient-mesh': 'gradient-texture',
};

// URLs come from manual review notes and often differ only by a trailing
// slash; normalize before the duplicate check so those don't slip through.
function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const path = stripTrailingSlashes(u.pathname);
    return `${u.protocol}//${u.host}${path}${u.search}`.toLowerCase();
  } catch {
    return stripTrailingSlashes(String(raw).trim().toLowerCase());
  }
}

function normalizeFontName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function validateSite(site, index) {
  const label = site && site.id ? `"${site.id}"` : `at index ${index}`;
  if (!site || typeof site.id !== 'string' || !site.id) {
    throw new Error(`Site ${label}: missing required "id"`);
  }
  if (!VALID_CAPTURE_STATUS.has(site.captureStatus)) {
    throw new Error(`Site ${label}: invalid captureStatus "${site.captureStatus}"`);
  }
  if (site.captureStatus !== 'reviewed' && !site.unscoredReason) {
    throw new Error(`Site ${label}: captureStatus "${site.captureStatus}" requires unscoredReason`);
  }
  const global = site.geometry?.global ?? null;
  if (global !== null && !VALID_GLOBAL_GEOMETRY.has(global)) {
    throw new Error(`Site ${label}: invalid geometry.global value "${global}"`);
  }
  for (const [role, value] of Object.entries(site.geometry?.byRole ?? {})) {
    if (value !== null && !VALID_ROLE_GEOMETRY.has(value)) {
      throw new Error(`Site ${label}: invalid geometry.byRole["${role}"] value "${value}"`);
    }
  }
  for (const mediaLabel of site.mediaTopTwo ?? []) {
    if (!VALID_MEDIA_LABELS.has(mediaLabel)) {
      throw new Error(`Site ${label}: invalid media label "${mediaLabel}"`);
    }
  }
}

function normalizeSite(site) {
  return {
    id: site.id,
    title: site.title ?? '',
    captureUrl: site.captureUrl,
    capturedAt: site.capturedAt ?? null,
    captureStatus: site.captureStatus,
    unscoredReason: site.unscoredReason ?? null,
    fonts: {
      accepted: [...(site.fonts?.accepted ?? [])],
      rejected: [...(site.fonts?.rejected ?? [])],
    },
    geometry: {
      global: site.geometry?.global ?? null,
      byRole: { ...(site.geometry?.byRole ?? {}) },
    },
    mediaTopTwo: [...(site.mediaTopTwo ?? [])],
    reviewer: site.reviewer,
    notes: site.notes ?? '',
  };
}

/** Validate + normalize a raw semantic ground-truth document. Throws on any structural defect. */
export function loadSemanticGroundTruth(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Ground truth must be an object');
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion "${value.schemaVersion}" (expected 1)`);
  }
  if (!Array.isArray(value.sites)) {
    throw new Error('Ground truth is missing "sites" (must be an array)');
  }

  const seenIds = new Set();
  const seenUrls = new Set();
  value.sites.forEach((site, index) => {
    validateSite(site, index);
    if (seenIds.has(site.id)) {
      throw new Error(`Duplicate site id: "${site.id}"`);
    }
    seenIds.add(site.id);

    const normalizedUrl = normalizeUrl(site.captureUrl);
    if (seenUrls.has(normalizedUrl)) {
      throw new Error(`Duplicate captureUrl (after normalization): "${normalizedUrl}"`);
    }
    seenUrls.add(normalizedUrl);
  });

  return {
    schemaVersion: 1,
    viewport: { ...(value.viewport ?? {}) },
    sites: value.sites.map(normalizeSite),
  };
}

// Extractor output shape has drifted across versions; read both the current
// and legacy field names so older captured extractions still score.
function getPromotedFamilies(extraction) {
  const accepted = extraction?.typography?.system?.acceptedFamilies;
  if (Array.isArray(accepted)) return accepted.map((f) => f?.name);
  const families = extraction?.typography?.families;
  if (Array.isArray(families)) return families.map((f) => f?.name);
  return [];
}

function mapLegacyMediaLabel(label) {
  return LEGACY_MEDIA_LABELS[label] ?? label;
}

function getExtractionMediaLabels(extraction) {
  const distribution = extraction?.imageryStyle?.distribution;
  if (Array.isArray(distribution)) {
    return distribution.slice(0, 2).map((d) => mapLegacyMediaLabel(d?.label));
  }
  const label = extraction?.imageryStyle?.label;
  return label ? [mapLegacyMediaLabel(label)] : [];
}

function scoreFonts(site, extraction) {
  const acceptedNorm = site.fonts.accepted.map(normalizeFontName);
  const rejectedNorm = site.fonts.rejected.map(normalizeFontName);
  const promoted = getPromotedFamilies(extraction);
  const promotedNorm = promoted.map(normalizeFontName);

  const retained = acceptedNorm.filter((a) => promotedNorm.includes(a)).length;
  const falsePositives = promotedNorm.filter((p) => rejectedNorm.includes(p)).length;

  return {
    accepted: site.fonts.accepted.length,
    promoted: promoted.length,
    retained,
    falsePositives,
  };
}

function scoreGeometry(site, extraction) {
  const truthGlobal = site.geometry.global;
  const extractionGlobal = extraction?.borders?.geometry?.global?.value ?? null;
  const globalScored = truthGlobal !== null;
  const globalCorrect = globalScored && extractionGlobal === truthGlobal;
  const incidentalFlip = truthGlobal === 'square' && (extractionGlobal === 'pill' || extractionGlobal === 'rounded');

  let roleScored = 0;
  let roleCorrect = 0;
  for (const [role, truthValue] of Object.entries(site.geometry.byRole)) {
    if (truthValue === null) continue;
    roleScored += 1;
    const extractionValue = extraction?.borders?.geometry?.byRole?.[role]?.value ?? null;
    if (extractionValue === truthValue) roleCorrect += 1;
  }

  return { globalScored, globalCorrect, roleScored, roleCorrect, incidentalFlip };
}

function scoreMedia(site, extraction) {
  const labels = getExtractionMediaLabels(extraction);
  const hit = site.mediaTopTwo.some((truthLabel) => labels.includes(truthLabel));
  const photographyFalsePositive =
    labels[0] === 'photography' &&
    !site.mediaTopTwo.includes('photography') &&
    !site.mediaTopTwo.includes('product-photography');
  return { hit, photographyFalsePositive };
}

const ratio = (num, den) => (den > 0 ? num / den : 0);

const HERO_WINDOW = 3;

// A lazy-loader placeholder: a data: SVG with nothing drawn in it (the
// lazysizes shape). Base64 SVG drawings and base64 raster images are real
// inline media and must not count.
const DRAWING_ELEMENT_RE = /<(path|rect|circle|ellipse|polygon|polyline|line|image|text|g|use)\b/i;
const BASE64_RASTER_PLACEHOLDER_BYTES = 200;

export function isPlaceholderMediaSrc(src) {
  if (typeof src !== 'string') return false;

  const base64Svg = /^data:image\/svg\+xml;base64,(.*)$/i.exec(src);
  if (base64Svg) {
    let markup;
    try { markup = Buffer.from(base64Svg[1], 'base64').toString('utf8'); } catch { return false; }
    return !DRAWING_ELEMENT_RE.test(markup);
  }

  const base64Raster = /^data:image\/(gif|png|jpeg|jpg|webp|avif);base64,(.*)$/i.exec(src);
  if (base64Raster) {
    let bytes;
    try { bytes = Buffer.from(base64Raster[2], 'base64').length; } catch { return false; }
    return bytes < BASE64_RASTER_PLACEHOLDER_BYTES;
  }

  if (!/^data:image\/svg\+xml/i.test(src)) return false;
  let markup = src;
  try { markup = decodeURIComponent(src); } catch { /* keep raw */ }
  return !DRAWING_ELEMENT_RE.test(markup);
}

/** Blueprint gates need no ground truth: they read the extraction alone. */
export function scoreBlueprintGates(extractionsById = {}) {
  const perSite = Object.entries(extractionsById).map(([id, extraction]) => {
    const bp = extraction?.blueprint || {};
    const roles = Array.isArray(bp.readingOrder) ? bp.readingOrder : [];
    const heroIndex = roles.indexOf('hero');
    const bands = Array.isArray(bp.bands) ? bp.bands : [];
    return {
      id,
      bands: bands.length,
      heroIndex,
      heroAtTop: heroIndex >= 0 && heroIndex < HERO_WINDOW,
      oversizedDropped: Number(bp.counts?.oversizedDropped) || 0,
      firstRoles: roles.slice(0, HERO_WINDOW),
      placeholderMedia: bands.filter((b) => isPlaceholderMediaSrc(b.media && b.media.src)).length,
    };
  });
  return {
    sites: perSite.length,
    heroAtTop: perSite.filter((s) => s.heroAtTop).length,
    oversizedSites: perSite.filter((s) => s.oversizedDropped > 0).length,
    placeholderMediaSites: perSite.filter((s) => s.placeholderMedia > 0).length,
    perSite,
  };
}

/** Score an extractor's output against a loaded ground-truth set. Only 'reviewed' sites count. */
export function scoreSemanticExtraction(groundTruth, extractionsById) {
  const unscored = [];
  const perSite = [];

  const fonts = { acceptedTotal: 0, retained: 0, falsePositives: 0, promotedTotal: 0 };
  const geometry = {
    scored: 0, correct: 0, globalScored: 0, globalCorrect: 0,
    roleScored: 0, roleCorrect: 0, incidentalFlips: 0,
  };
  const media = { scored: 0, hits: 0, photographyFalsePositives: 0 };

  for (const site of groundTruth.sites) {
    if (site.captureStatus !== 'reviewed') {
      unscored.push({ id: site.id, reason: site.unscoredReason || site.captureStatus });
      continue;
    }
    const extraction = extractionsById[site.id];
    if (!extraction) {
      unscored.push({ id: site.id, reason: 'no extraction' });
      continue;
    }

    const fontResult = scoreFonts(site, extraction);
    fonts.acceptedTotal += fontResult.accepted;
    fonts.retained += fontResult.retained;
    fonts.falsePositives += fontResult.falsePositives;
    fonts.promotedTotal += fontResult.promoted;

    const geoResult = scoreGeometry(site, extraction);
    geometry.globalScored += geoResult.globalScored ? 1 : 0;
    geometry.globalCorrect += geoResult.globalCorrect ? 1 : 0;
    geometry.roleScored += geoResult.roleScored;
    geometry.roleCorrect += geoResult.roleCorrect;
    if (geoResult.incidentalFlip) geometry.incidentalFlips += 1;

    const mediaResult = scoreMedia(site, extraction);
    media.scored += 1;
    if (mediaResult.hit) media.hits += 1;
    if (mediaResult.photographyFalsePositive) media.photographyFalsePositives += 1;

    perSite.push({
      id: site.id,
      fonts: { retained: fontResult.retained, accepted: fontResult.accepted, falsePositives: fontResult.falsePositives },
      geometry: geoResult,
      media: mediaResult,
    });
  }

  geometry.scored = geometry.globalScored + geometry.roleScored;
  geometry.correct = geometry.globalCorrect + geometry.roleCorrect;

  return {
    fonts: { ...fonts, recall: ratio(fonts.retained, fonts.acceptedTotal) },
    geometry: { ...geometry, accuracy: ratio(geometry.correct, geometry.scored) },
    media: {
      ...media,
      recall: ratio(media.hits, media.scored),
      photographyFalsePositiveRate: ratio(media.photographyFalsePositives, media.scored),
    },
    unscored,
    perSite,
    blueprint: scoreBlueprintGates(extractionsById),
  };
}

function gateRow(name, passed, detail, n) {
  return `| ${name} | ${detail} | n=${n} | ${passed ? 'PASS' : 'FAIL'} |`;
}

/** Render a short markdown scorecard with per-gate PASS/FAIL and sample sizes. */
export function formatSemanticScorecard(score) {
  const rows = [
    gateRow(
      'Font precision (0 false positives)',
      score.fonts.falsePositives === 0,
      `${score.fonts.falsePositives}/${score.fonts.promotedTotal} false positives`,
      score.fonts.promotedTotal,
    ),
    gateRow(
      'Font recall >= 0.95',
      score.fonts.recall >= 0.95,
      `${score.fonts.recall.toFixed(2)} (${score.fonts.retained}/${score.fonts.acceptedTotal})`,
      score.fonts.acceptedTotal,
    ),
    gateRow(
      'Geometry accuracy, incidentalFlips = 0',
      score.geometry.incidentalFlips === 0,
      `${score.geometry.accuracy.toFixed(2)} (${score.geometry.correct}/${score.geometry.scored}), flips=${score.geometry.incidentalFlips}`,
      score.geometry.scored,
    ),
    gateRow(
      'Media top-two recall >= 0.90',
      score.media.recall >= 0.90,
      `${score.media.recall.toFixed(2)} (${score.media.hits}/${score.media.scored})`,
      score.media.scored,
    ),
    gateRow(
      'Photography false-positive rate < 0.05',
      score.media.photographyFalsePositiveRate < 0.05,
      `${score.media.photographyFalsePositiveRate.toFixed(2)} (${score.media.photographyFalsePositives}/${score.media.scored})`,
      score.media.scored,
    ),
    ...(score.blueprint ? [
      gateRow('Hero at top on >= 14/16 sites', score.blueprint.sites === 0 || score.blueprint.heroAtTop / score.blueprint.sites >= 14 / 16, `${score.blueprint.heroAtTop}/${score.blueprint.sites}`, score.blueprint.sites),
      gateRow('No oversized band on any site', score.blueprint.oversizedSites === 0, `${score.blueprint.oversizedSites} sites`, score.blueprint.sites),
      gateRow('No placeholder media source on any site', score.blueprint.placeholderMediaSites === 0, `${score.blueprint.placeholderMediaSites} sites`, score.blueprint.sites),
    ] : []),
  ];

  return [
    '| Gate | Result | Sample | Status |',
    '|---|---|---|---|',
    ...rows,
    '',
    `Unscored sites: ${score.unscored.length}${score.unscored.length ? ' (' + score.unscored.map((u) => `${u.id}: ${u.reason}`).join('; ') + ')' : ''}`,
  ].join('\n');
}
