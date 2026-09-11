// Font promotion by provenance: decide which font-family names a page
// *actually* uses as brand typography, versus CSS noise (generic stacks,
// icon fonts, malformed declaration values that leaked into fontFamily).
// No parser dependency — quote-aware comma splitting is hand-rolled below,
// same approach the CSS spec itself uses for font-family lists.

const CSS_GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'emoji', 'math', 'fangsong',
  '-apple-system', 'blinkmacsystemfont',
]);
const UI_GENERIC_RE = /^ui-/i;

const ICON_FAMILY_RE = /^(material[-\s]?icons|font\s?awesome|fa-?solid|fa-?regular|fa-?brands|ionicons|glyphicons|bootstrap-icons|remixicon|feather|tabler-icons|lucide)/i;
// Site-specific icon faces ("aurberge-icons", "Apple Icons 100") render
// ligature glyphs as text nodes, so hasText alone cannot filter them.
const ICON_NAME_RE = /\bicons?\b/i;

// OS faces that every page can fall back to. They become brand typography
// only when they carry real visible share or the site declares them itself.
const SYSTEM_FACES = new Set([
  'arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'georgia',
  'verdana', 'tahoma', 'trebuchet ms', 'courier', 'courier new', 'segoe ui',
  'apple color emoji', 'segoe ui emoji', 'noto color emoji',
]);
const SYSTEM_FACE_MIN_SHARE = 0.10;
// Minor families (a cookie widget's font, a fallback on one form field) are
// observed but not promoted: they need a heading, ten text elements, or 1%
// of the page's text elements.
const MINOR_FAMILY_MIN_TEXT = 10;
const MINOR_FAMILY_MIN_SHARE = 0.01;

const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;
const MAX_ENTRY_LEN = 128;
const MAX_INPUT_LEN = 4096;

function isGenericName(name) {
  const lower = name.toLowerCase();
  return CSS_GENERIC_FAMILIES.has(lower) || UI_GENERIC_RE.test(lower);
}

// Split on commas that are not inside a quoted string — a family like
// `"ACME, Display"` embeds a comma that must not become a stack boundary.
function quoteAwareSplit(str) {
  const out = [];
  let cur = '';
  let quoteChar = null;
  for (const ch of str) {
    if (quoteChar) {
      cur += ch;
      if (ch === quoteChar) quoteChar = null;
    } else if (ch === '"' || ch === "'") {
      quoteChar = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Strip only a matching *outer* quote pair — inner quotes (there shouldn't
// be any after quote-aware splitting, but be defensive) are left alone.
function stripOuterQuotes(segment) {
  if (segment.length >= 2) {
    const first = segment[0];
    const last = segment[segment.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return { name: segment.slice(1, -1), quoted: true };
    }
  }
  return { name: segment, quoted: false };
}

export function parseFontFamilyList(raw) {
  if (!raw) return [];
  const str = String(raw);
  if (str.length > MAX_INPUT_LEN) return [];

  const out = [];
  for (const segment of quoteAwareSplit(str)) {
    const trimmedOuter = segment.trim();
    if (!trimmedOuter) continue;
    const { name: unquoted, quoted } = stripOuterQuotes(trimmedOuter);
    const name = unquoted.trim();
    if (!name) continue;
    if (name.length > MAX_ENTRY_LEN) continue;
    if (CONTROL_CHAR_RE.test(name)) continue;
    if (name.includes(':') || name.includes(';')) continue;
    out.push({ name, generic: isGenericName(name), quoted });
  }
  return out;
}

function normKey(name) {
  return String(name || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// The first non-generic stack member is the "rendered family" for an
// element — generic-only stacks (e.g. just `system-ui`) render as whatever
// the OS picks, which isn't brand typography.
function firstRenderedFamily(fontFamily) {
  const parsed = parseFontFamilyList(fontFamily);
  return parsed.find(f => !f.generic) || null;
}

// Sum weighted votes for accepted families among elements matching `tags`,
// then report the plurality winner as a SemanticDecision.
function decideFamily(acceptedFamilies, computedStyles, tags) {
  const acceptedByKey = new Map(acceptedFamilies.map(f => [f.name.toLowerCase(), f]));
  const votes = new Map();
  let total = 0;
  for (const el of computedStyles) {
    if (!el.hasText || !tags.has(el.tag)) continue;
    const first = firstRenderedFamily(el.fontFamily);
    if (!first) continue;
    const key = first.name.toLowerCase();
    if (!acceptedByKey.has(key)) continue;
    votes.set(key, (votes.get(key) || 0) + 1);
    total++;
  }
  if (total === 0) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [winnerKey, winnerCount] = ranked[0];
  const winner = acceptedByKey.get(winnerKey);
  return {
    value: winner.name,
    confidence: round2(winnerCount / total),
    coverage: { sampleCount: total, winnerCount },
    reasons: winner.reasons,
    alternatives: ranked.slice(1).map(([key, count]) => ({ name: acceptedByKey.get(key).name, count })),
  };
}

const BODY_TAGS = new Set(['p', 'li', 'span', 'div', 'a', 'td', 'label']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3']);

export function extractFontSystem({ computedStyles = [], fontData = {} } = {}) {
  const documentFonts = fontData.documentFonts || [];
  const fontFaces = fontData.fontFaces || [];
  const googleFontsLinks = fontData.googleFontsLinks || [];

  const loadedNames = new Set(
    documentFonts.filter(d => d && d.status === 'loaded').map(d => normKey(d.family)).filter(Boolean)
  );
  const faceNames = new Set(fontFaces.map(f => normKey(f && f.family)).filter(Boolean));
  const googleFontsText = googleFontsLinks.join(' ').toLowerCase();

  // Aggregate three buckets while walking every rendered element once:
  // real candidate families, generic-only stacks, and malformed values that
  // parsed to nothing (declaration-shaped garbage like `object-fit: contain`).
  const stats = new Map(); // lower name -> { name, textCount, totalCount }
  const genericHits = new Map();
  const invalidHits = new Map();
  let textElements = 0;

  for (const el of computedStyles) {
    if (el.hasText) textElements++;
    const raw = el.fontFamily;
    const parsed = parseFontFamilyList(raw);
    const first = parsed.find(f => !f.generic);
    if (first) {
      const key = first.name.toLowerCase();
      if (!stats.has(key)) stats.set(key, { name: first.name, textCount: 0, totalCount: 0, headingCount: 0 });
      const s = stats.get(key);
      s.totalCount++;
      if (el.hasText) {
        s.textCount++;
        if (HEADING_TAGS.has(el.tag)) s.headingCount++;
      }
    } else if (parsed.length > 0) {
      const g = parsed[0].name;
      genericHits.set(g, (genericHits.get(g) || 0) + 1);
    } else if (raw && String(raw).trim()) {
      const { name } = stripOuterQuotes(String(raw).trim().slice(0, MAX_ENTRY_LEN));
      invalidHits.set(name, (invalidHits.get(name) || 0) + 1);
    }
  }

  const acceptedFamilies = [];
  const rejectedFamilies = [];
  let withProvenance = 0;

  for (const stat of stats.values()) {
    const key = normKey(stat.name);
    if (ICON_FAMILY_RE.test(stat.name) || ICON_NAME_RE.test(stat.name)) {
      rejectedFamilies.push({ name: stat.name, reason: 'icon font', count: stat.totalCount });
      continue;
    }

    const hasLoaded = loadedNames.has(key);
    const hasFace = faceNames.has(key);
    const hasGoogle = [key, key.replace(/\s+/g, '+'), key.replace(/\s+/g, '%20')]
      .some(v => v && googleFontsText.includes(v));
    const textShare = textElements > 0 ? stat.textCount / textElements : 0;
    const hasVisibleText = stat.textCount >= 3 || (textElements > 0 && textShare >= MINOR_FAMILY_MIN_SHARE);

    if (hasLoaded || hasFace || hasGoogle) withProvenance++;

    const reasons = [];
    let score = 0;
    if (hasLoaded) { reasons.push('loaded-font'); score += 0.45; }
    if (hasFace) { reasons.push('font-face'); score += 0.2; }
    if (hasGoogle) { reasons.push('google-fonts'); score += 0.15; }
    if (hasVisibleText) { reasons.push('visible-text'); score += 0.2; }

    // Promotion needs provenance AND visible use. A loaded face that renders
    // no text at capture (a hover-only or hidden-menu font) stays observed;
    // a minor family (a cookie widget's font, one fallback field) is not the
    // system; an OS face is the brand only with real share or a declaration.
    const record = { name: stat.name, textCount: stat.textCount, totalCount: stat.totalCount, score: round2(score), reasons };
    // A computed family with no loaded font, no @font-face and no Google
    // link never rendered: the browser drew a fallback (auberge.com's
    // "Lato" on 17 widget elements). Only an OS face with real share
    // escapes this, because OS faces need no download to render.
    const hasProvenance = hasLoaded || hasFace || hasGoogle;
    const systemFaceWithShare = SYSTEM_FACES.has(key) && textShare >= SYSTEM_FACE_MIN_SHARE;
    let reason = null;
    if (!hasProvenance && !systemFaceWithShare) {
      reason = SYSTEM_FACES.has(key) ? 'system face below share threshold' : 'no rendered, authored, or loaded provenance';
    }
    else if (stat.textCount === 0) reason = 'no visible text';
    else if (!(stat.headingCount > 0 || stat.textCount >= MINOR_FAMILY_MIN_TEXT || textShare >= MINOR_FAMILY_MIN_SHARE)) reason = 'below visible-text share threshold';
    else if (SYSTEM_FACES.has(key) && !(hasFace || hasGoogle) && textShare < SYSTEM_FACE_MIN_SHARE && stat.headingCount === 0) reason = 'system face below share threshold';

    if (reason) rejectedFamilies.push({ name: stat.name, reason, count: stat.totalCount, textCount: stat.textCount });
    else acceptedFamilies.push(record);
  }

  for (const [name, count] of genericHits) {
    rejectedFamilies.push({ name, reason: 'generic family', count });
  }
  for (const [name, count] of invalidHits) {
    rejectedFamilies.push({ name, reason: 'declaration-shaped value', count });
  }

  const bodyFamily = decideFamily(acceptedFamilies, computedStyles, BODY_TAGS);
  const headingFamily = decideFamily(acceptedFamilies, computedStyles, HEADING_TAGS);

  return {
    bodyFamily,
    headingFamily,
    acceptedFamilies,
    rejectedFamilies,
    coverage: {
      textElements,
      withProvenance,
      accepted: acceptedFamilies.length,
      rejected: rejectedFamilies.length,
    },
  };
}
