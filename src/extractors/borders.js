import { parseCSSValue, clusterValues } from '../utils.js';
import { inferOwner } from './geometry-system.js';

const MAX_OBSERVED = 200;

function parseBorderRadius(raw) {
  if (!raw || raw === '0px') return [];
  // Handle slash-separated (x/y) syntax — take the x part
  const parts = raw.split('/')[0].trim().split(/\s+/);
  const values = [];
  for (const p of parts) {
    const v = parseCSSValue(p);
    if (v && v.value > 0) values.push(Math.round(v.value));
  }
  return values;
}

// Expands a border-radius shorthand into its four authored corners, per the
// CSS clockwise rule (top-left, top-right, bottom-right, bottom-left),
// without rounding zero away or converting % to px — the two units aren't
// comparable so each corner keeps the unit it was authored in.
export function parseCornerRadii(shorthand) {
  const fallback = { corners: [0, 0, 0, 0], units: ['px', 'px', 'px', 'px'] };
  if (!shorthand || typeof shorthand !== 'string') return fallback;

  // '8px / 4px' (elliptical corners) — the horizontal radii describe the
  // corner shape for our purposes.
  const horizontal = shorthand.split('/')[0].trim();
  if (!horizontal) return fallback;

  const parts = horizontal.split(/\s+/).filter(Boolean).slice(0, 4);
  if (parts.length === 0) return fallback;

  // Computed radii can arrive in scientific notation ('3.35544e+07px' on
  // n26.com's buttons); parseCSSValue has no exponent support, and reading
  // that as 0 would turn a pill into a square.
  const EXPONENT_RE = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(px|%|rem|em|pt)?$/i;
  const parsed = parts.map(p => {
    const v = parseCSSValue(p);
    if (v) return { value: v.value, unit: v.unit || 'px' };
    const m = p.match(EXPONENT_RE);
    if (m && Number.isFinite(Number(m[1]))) return { value: Math.max(0, Number(m[1])), unit: m[2] || 'px' };
    return { value: 0, unit: 'px' };
  });
  const vals = parsed.map(p => p.value);
  const units = parsed.map(p => p.unit);

  if (vals.length === 1) return { corners: [vals[0], vals[0], vals[0], vals[0]], units: [units[0], units[0], units[0], units[0]] };
  if (vals.length === 2) return { corners: [vals[0], vals[1], vals[0], vals[1]], units: [units[0], units[1], units[0], units[1]] };
  if (vals.length === 3) return { corners: [vals[0], vals[1], vals[2], vals[1]], units: [units[0], units[1], units[2], units[1]] };
  return { corners: [vals[0], vals[1], vals[2], vals[3]], units: [units[0], units[1], units[2], units[3]] };
}

// Groups elements' authored corners by shape+unit+tag+owner, zero included —
// the raw evidence behind geometry-system's role-aware promotion. Shared by
// borders.observed and geometry-system's own `observed` output.
export function computeObservedRadii(computedStyles) {
  const groups = new Map();
  for (const el of computedStyles) {
    if (!el.borderRadius) continue;
    const { corners, units } = parseCornerRadii(el.borderRadius);
    const uniqueUnits = new Set(units);
    const unit = uniqueUnits.size === 1 ? [...uniqueUnits][0] : 'mixed';
    const owner = inferOwner(el);
    const tag = el.tag || '';
    const area = typeof el.area === 'number' ? el.area : 0;
    const key = `${corners.join(',')}|${unit}|${tag}|${owner}`;

    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (area > existing.maxArea) existing.maxArea = area;
    } else {
      groups.set(key, { corners, unit, tag, owner, count: 1, maxArea: area });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_OBSERVED);
}

export function extractBorders(computedStyles) {
  const radiiSet = new Map(); // value -> count
  const widthSet = new Set();
  const styleSet = new Set();

  for (const el of computedStyles) {
    if (el.borderRadius && el.borderRadius !== '0px') {
      const values = parseBorderRadius(el.borderRadius);
      if (values.length > 0) {
        // Use the max value from the shorthand as the representative
        const representative = Math.max(...values);
        radiiSet.set(representative, (radiiSet.get(representative) || 0) + 1);
      }
    }

    // Collect border widths
    if (el.borderWidth) {
      const parts = el.borderWidth.split(/\s+/);
      for (const p of parts) {
        const v = parseCSSValue(p);
        if (v && v.value > 0) widthSet.add(Math.round(v.value));
      }
    }

    // Collect border styles
    if (el.borderStyle) {
      const parts = el.borderStyle.split(/\s+/);
      for (const p of parts) {
        if (p && p !== 'none' && p !== 'initial') styleSet.add(p);
      }
    }
  }

  const sorted = [...radiiSet.keys()].sort((a, b) => a - b);
  const clustered = clusterValues(sorted, 2);

  const radii = clustered.map(v => {
    let label;
    if (v <= 2) label = 'xs';
    else if (v <= 5) label = 'sm';
    else if (v <= 10) label = 'md';
    else if (v <= 16) label = 'lg';
    else if (v <= 24) label = 'xl';
    else label = 'full';
    return { value: v, label, count: radiiSet.get(v) || 0 };
  });

  const widths = [...widthSet].sort((a, b) => a - b);
  const styles = [...styleSet].sort();

  return { radii, widths, styles, observed: computeObservedRadii(computedStyles) };
}
