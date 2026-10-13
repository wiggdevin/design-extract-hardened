import { parseCSSValue } from '../utils.js';
import { parseFontFamilyList } from './font-system.js';

// Filter set for fonts that aren't part of the site's brand typography:
// generic CSS fallbacks, OS UI stacks, icon fonts, and inherited "no
// declaration" values. These slipped into families[] before and polluted
// the brand book + grade summary.
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  'inherit', 'initial', 'unset', 'revert', 'auto', '-apple-system',
  'blinkmacsystemfont', 'apple-system',
]);
const ICON_FAMILY_RE = /^(material[-\s]?icons|font\s?awesome|fa-?solid|fa-?regular|fa-?brands|ionicons|glyphicons|bootstrap-icons|remixicon|feather|tabler-icons|lucide)/i;

function normaliseFamily(raw) {
  if (!raw) return null;
  // Quote-aware split (a comma inside quotes, e.g. `"ACME, Display"`, must
  // not become a stack boundary) then take the first NON-generic member —
  // sites declare e.g. `"Inter", "Helvetica Neue", sans-serif` and the
  // first entry is the *intended* family, but a stack can also lead with a
  // generic keyword the real name should skip past.
  const first = parseFontFamilyList(raw).find(f => !f.generic);
  return first ? first.name : null;
}

function isMeaningfulFamily(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (GENERIC_FAMILIES.has(lower)) return false;
  if (ICON_FAMILY_RE.test(name)) return false;
  // Single-character or all-symbol names are extraction noise.
  if (name.length < 2) return false;
  if (!/[a-z]/i.test(name)) return false;
  // A CSS declaration value leaking into fontFamily (e.g. malformed capture
  // producing `object-fit: contain`) is not a real family name.
  if (name.includes(':') || name.includes(';')) return false;
  return true;
}


// ── Fluid typography ────────────────────────────────────────────
//
// Computed styles resolve `clamp()` to one px value at the capture viewport,
// so a site's responsive type ramp is invisible downstream. These parse the
// authored declarations the crawler harvests off the stylesheets.

const LEN_RE = /^(-?[\d.]+)(px|rem|em|vw|vh|vmin|vmax|%)?$/;

function toPx(raw, rootFontSize = 16, viewportWidth = 1440) {
  if (raw == null) return null;
  const m = String(raw).trim().match(LEN_RE);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  switch (m[2]) {
    case 'rem':
    case 'em': return value * rootFontSize;
    case 'vw': return (value / 100) * viewportWidth;
    case 'px':
    case undefined:
    case '': return value;
    default: return null;
  }
}

// Split on top-level commas — clamp() args can themselves nest calc(min(...)).
function splitArgs(inner) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else { cur += ch; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseFluidValue(value, { rootFontSize = 16, minViewport = 375, maxViewport = 1440 } = {}) {
  if (!value) return null;
  const raw = String(value).trim();
  const clamp = raw.match(/clamp\(([\s\S]+)\)\s*$/i);
  if (clamp) {
    const args = splitArgs(clamp[1]);
    if (args.length !== 3) return null;
    const [min, preferred, max] = args;
    return {
      raw,
      kind: 'clamp',
      min,
      preferred,
      max,
      minPx: toPx(min, rootFontSize, minViewport),
      maxPx: toPx(max, rootFontSize, maxViewport),
      // A clamp whose middle term has no viewport unit never actually
      // scales — worth surfacing, it is a common authoring mistake.
      scales: /v(w|h|min|max|i|b)\b/i.test(preferred),
    };
  }
  if (/[\d.]+\s*v(w|h|min|max|i|b)\b/i.test(raw)) {
    return {
      raw,
      kind: 'viewport',
      min: null,
      preferred: raw,
      max: null,
      minPx: toPx(raw, rootFontSize, minViewport),
      maxPx: toPx(raw, rootFontSize, maxViewport),
      scales: true,
    };
  }
  return null;
}

// ── Modular scale ───────────────────────────────────────────────

const RATIOS = [
  { name: 'minor second', value: 1.067 },
  { name: 'major second', value: 1.125 },
  { name: 'minor third', value: 1.2 },
  { name: 'major third', value: 1.25 },
  { name: 'perfect fourth', value: 1.333 },
  { name: 'augmented fourth', value: 1.414 },
  { name: 'perfect fifth', value: 1.5 },
  { name: 'golden', value: 1.618 },
];

// Infer the ratio a type scale was generated from. We fit each candidate
// against the steps between consecutive *distinct* sizes and keep the best
// average error — a real modular scale lands under ~4%.
export function inferTypeRatio(sizes) {
  const distinct = [...new Set(sizes.filter(s => s > 0))].sort((a, b) => a - b);
  if (distinct.length < 3) return { value: null, name: 'none', fit: 0, steps: distinct.length };

  const steps = [];
  for (let i = 1; i < distinct.length; i++) {
    const r = distinct[i] / distinct[i - 1];
    if (r > 1.01 && r < 3) steps.push(r);
  }
  if (steps.length < 2) return { value: null, name: 'none', fit: 0, steps: distinct.length };

  let best = null;
  for (const candidate of RATIOS) {
    // Each observed step should be the ratio raised to a small integer power.
    // Without a power penalty every scale "fits" the smallest ratio — 1.067
    // to the 4th explains a perfect-fourth step to within 3%.
    let error = 0;
    let powerSum = 0;
    for (const step of steps) {
      const rawPower = Math.log(step) / Math.log(candidate.value);
      const power = Math.max(1, Math.round(rawPower));
      const expected = Math.pow(candidate.value, power);
      error += Math.abs(step - expected) / expected;
      error += power > 3 ? 0.5 : 0;
      powerSum += power;
    }
    const avgPower = powerSum / steps.length;
    const score = error / steps.length + (avgPower - 1) * 0.03;
    if (!best || score < best.error) best = { ...candidate, error: score };
  }

  const fit = Math.max(0, Math.min(1, 1 - best.error / 0.15));

  // Coverage is the honest companion to fit: how many of the actual sizes
  // sit on a geometric ladder grown from the smallest one. A high fit with
  // low coverage means a couple of steps happen to line up and the rest
  // are one-offs.
  let onLadder = 0;
  let anchor = distinct[0];
  for (const candidateAnchor of distinct) {
    let hits = 0;
    for (const size of distinct) {
      const power = Math.log(size / candidateAnchor) / Math.log(best.value);
      const expected = candidateAnchor * Math.pow(best.value, Math.round(power));
      if (Math.abs(size - expected) / expected <= 0.05) hits++;
    }
    if (hits > onLadder) { onLadder = hits; anchor = candidateAnchor; }
  }
  const coverage = Math.round((onLadder / distinct.length) * 100) / 100;
  const named = fit >= 0.5;

  return {
    value: named ? best.value : null,
    name: named ? best.name : 'irregular',
    fit: Math.round(fit * 100) / 100,
    coverage: named ? coverage : 0,
    anchor: named ? anchor : null,
    steps: distinct.length,
  };
}

// ── Role naming ─────────────────────────────────────────────────

function roleFromTags(tags) {
  const heading = tags.find(t => /^h[1-6]$/.test(t));
  return heading || null;
}

// Give every step in the scale a name a developer can actually use. Heading
// tags claim their own name; everything else is placed relative to the body
// size, largest first.
function nameScale(scale, bodySize) {
  const claimed = new Set();
  const named = [];
  for (const step of scale) {
    const tagRole = roleFromTags(step.tags || []);
    if (tagRole && !claimed.has(tagRole)) {
      claimed.add(tagRole);
      named.push({ ...step, role: tagRole });
    } else {
      named.push({ ...step, role: null });
    }
  }

  let aboveIdx = 0;
  let belowIdx = 0;
  for (const step of named) {
    if (step.role) continue;
    if (bodySize != null && step.size === bodySize) {
      step.role = claimed.has('body') ? null : 'body';
      claimed.add('body');
      continue;
    }
    if (bodySize != null && step.size > bodySize) {
      // `display` belongs to the largest step on the page and nothing else —
      // handing it to whatever untagged size came first put a 32px step
      // above a 48px <h1>. Everything else becomes an ordered title rung.
      if (step === named[0] && !claimed.has('display')) {
        step.role = 'display';
        claimed.add('display');
      } else {
        aboveIdx++;
        step.role = `title-${aboveIdx}`;
      }
    } else {
      const candidates = ['body-sm', 'caption', 'micro'].filter(r => !claimed.has(r));
      step.role = candidates[belowIdx] || `sm-${belowIdx + 1}`;
      if (candidates[belowIdx]) claimed.add(candidates[belowIdx]);
      belowIdx++;
    }
  }
  return named;
}

// ── Measure ─────────────────────────────────────────────────────
//
// Characters per line — the single most load-bearing typographic number for
// readability, and one nobody can eyeball from a token dump. 45–75 is the
// classic comfortable band.

const TEXT_TAGS = new Set(['p', 'li', 'blockquote']);

function measureFrom(computedStyles) {
  const blocks = [];
  for (const el of computedStyles) {
    if (!TEXT_TAGS.has(el.tag)) continue;
    // Prefer the measured line box over the element box: a paragraph is as
    // wide as its container, its text usually is not.
    const width = typeof el.lineWidth === 'number' && el.lineWidth > 0
      ? el.lineWidth
      : (typeof el.width === 'number' ? el.width : null);
    const size = parseCSSValue(el.fontSize)?.value;
    if (!width || !size || width < 120) continue;
    blocks.push({ width, size, measured: typeof el.lineWidth === 'number' && el.lineWidth > 0 });
  }
  if (blocks.length === 0) return null;

  // Only prose columns count. A page's <p> elements include nav blurbs,
  // footer links and card captions; measuring the median across all of them
  // reports the width of the narrowest furniture, not of the reading column.
  const widest = Math.max(...blocks.map(b => b.width));
  let prose = blocks.filter(b => b.width >= widest * 0.5);
  if (prose.length < 3 && blocks.length < 8) {
    // A page with barely any paragraphs at all — widen the net to the top
    // third by width rather than reporting a one-sample measure as fact.
    // (A page with plenty of narrow paragraphs keeps the strict filter: the
    // narrow ones are furniture, not the reading column.)
    const byWidth = [...blocks].sort((a, b) => b.width - a.width);
    prose = byWidth.slice(0, Math.max(1, Math.ceil(byWidth.length / 3)));
  }
  // ~0.5em average glyph advance for latin text at normal tracking.
  const samples = prose.map(b => b.width / (b.size * 0.5));
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const cpl = Math.round(median);
  let verdict = 'comfortable';
  if (cpl < 45) verdict = 'narrow';
  else if (cpl > 75) verdict = 'wide';
  // Sample count is the honest caveat: a page with two paragraphs gives a
  // number, not a measurement.
  const confidence = samples.length >= 5 ? 'high' : samples.length >= 2 ? 'medium' : 'low';
  return {
    charsPerLine: cpl,
    verdict,
    confidence,
    samples: samples.length,
    measured: prose.every(b => b.measured),
  };
}

// ── Rhythm ladders ──────────────────────────────────────────────

function ladder(entries) {
  const counted = new Map();
  for (const [value, count] of entries) {
    if (value == null) continue;
    counted.set(value, (counted.get(value) || 0) + count);
  }
  return [...counted.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, count]) => ({ value, count }));
}

export function extractTypography(computedStyles, options = {}) {
  const familyCount = new Map();
  const sizeEntries = [];
  const weightCount = new Map();

  for (const el of computedStyles) {
    // Font families — normalised first-of-stack, with noise filtered out.
    const family = normaliseFamily(el.fontFamily);
    if (family && isMeaningfulFamily(family)) {
      familyCount.set(family, (familyCount.get(family) || 0) + 1);
    }

    // Font sizes
    const sizeVal = parseCSSValue(el.fontSize);
    if (sizeVal) {
      sizeEntries.push({
        size: sizeVal.value,
        weight: el.fontWeight,
        lineHeight: el.lineHeight,
        letterSpacing: el.letterSpacing,
        tag: el.tag,
        family,
      });
    }

    // Weights
    if (el.fontWeight) weightCount.set(el.fontWeight, (weightCount.get(el.fontWeight) || 0) + 1);
  }

  // Unique font families sorted by usage
  const families = [...familyCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const usedOn = computedStyles
        .filter(el => el.fontFamily?.includes(name))
        .map(el => el.tag);
      const headingUse = usedOn.some(t => /^h[1-6]$/.test(t));
      const bodyUse = usedOn.some(t => ['p', 'span', 'li', 'div'].includes(t));
      return { name, count, usage: headingUse && bodyUse ? 'all' : headingUse ? 'headings' : 'body' };
    });

  // Build type scale from unique sizes
  const sizeMap = new Map();
  for (const entry of sizeEntries) {
    const key = entry.size;
    if (!sizeMap.has(key)) {
      sizeMap.set(key, { size: entry.size, weight: entry.weight, lineHeight: entry.lineHeight, letterSpacing: entry.letterSpacing, tags: new Set(), count: 0 });
    }
    const s = sizeMap.get(key);
    s.tags.add(entry.tag);
    s.count++;
  }

  const scale = [...sizeMap.values()]
    .sort((a, b) => b.size - a.size)
    .map(s => ({ ...s, tags: [...s.tags] }));

  // Identify heading sizes (from h1-h6 tags)
  const headings = scale.filter(s => s.tags.some(t => /^h[1-6]$/.test(t)));

  // Body text: most common size on p/span/li
  const bodyEntries = sizeEntries.filter(e => ['p', 'span', 'li'].includes(e.tag));
  const bodySizeCount = new Map();
  for (const e of bodyEntries) bodySizeCount.set(e.size, (bodySizeCount.get(e.size) || 0) + 1);
  const bodySize = [...bodySizeCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const body = bodySize ? scale.find(s => s.size === bodySize[0]) : null;

  // Weights
  const weights = [...weightCount.entries()].sort((a, b) => b[1] - a[1]).map(([w, count]) => ({ weight: w, count }));

  // ── System-level analysis (v13.2) ──
  // Everything above is an inventory. What follows is the *system*: the
  // ratio the scale was generated from, a usable name per step, the fluid
  // ramp, the line-length verdict and the rhythm ladders.
  const ratio = inferTypeRatio(scale.map(s => s.size));
  const roleScale = nameScale(scale, body ? body.size : null);
  const measure = measureFrom(computedStyles);

  const lineHeights = ladder(sizeEntries.map(e => [e.lineHeight, 1]));
  const tracking = ladder(sizeEntries.map(e => [e.letterSpacing, 1]).filter(([v]) => v && v !== 'normal'));

  const fluidOpts = {
    rootFontSize: options.rootFontSize || 16,
    minViewport: options.minViewport || 375,
    maxViewport: options.viewportWidth || options.maxViewport || 1440,
  };
  const fluidDeclarations = (options.fluidValues || []).filter(f => f.property === 'font-size' || f.property === 'line-height');
  const fluidSeen = new Set();
  const fluid = [];
  for (const decl of fluidDeclarations) {
    const parsed = parseFluidValue(decl.value, fluidOpts);
    if (!parsed) continue;
    const key = `${decl.property}|${parsed.raw}`;
    if (fluidSeen.has(key)) continue;
    fluidSeen.add(key);
    fluid.push({ property: decl.property, selector: decl.selector, ...parsed });
  }
  fluid.sort((a, b) => (b.maxPx || 0) - (a.maxPx || 0));

  const fontSizeFluid = fluid.filter(f => f.property === 'font-size');
  const system = {
    ratio,
    measure,
    fluid: {
      isFluid: fontSizeFluid.length > 0,
      count: fontSizeFluid.length,
      // A clamp with no viewport unit in its preferred term is inert.
      inertCount: fontSizeFluid.filter(f => f.kind === 'clamp' && !f.scales).length,
      range: (() => {
        // Only declarations we could actually resolve to px contribute —
        // `min(var(--heading-md), 2.75vw)` is fluid but unmeasurable here.
        const mins = fontSizeFluid.map(f => f.minPx).filter(v => v != null);
        const maxes = fontSizeFluid.map(f => f.maxPx).filter(v => v != null);
        if (mins.length === 0 && maxes.length === 0) return null;
        return {
          minPx: mins.length ? Math.min(...mins) : null,
          maxPx: maxes.length ? Math.max(...maxes) : null,
        };
      })(),
      resolvedCount: fontSizeFluid.filter(f => f.minPx != null || f.maxPx != null).length,
    },
    sizeCount: scale.length,
    familyCount: families.length,
  };

  return { families, scale, headings, body, weights, roleScale, lineHeights, tracking, fluid, system };
}
