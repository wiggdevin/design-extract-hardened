// Blueprint comparison: did the clone reproduce the page's band structure?
// Bands are aligned by index. Five checks per aligned pair; each band missing
// on either side costs a full five. This separates an extraction fault (the
// original's blueprint is wrong) from a build fault (the blueprint is right
// and the clone's band differs).
import { colorDistance } from '../site-synthesis.js';

const CHECKS = 5;
const COLOR_TOLERANCE = 0.08;
const HEIGHT_TOLERANCE = 0.15;

function backgroundMatch(a = {}, b = {}) {
  if (a.hasVideo || b.hasVideo) return !!a.hasVideo && !!b.hasVideo;
  if (a.imageUrl || b.imageUrl) return !!a.imageUrl && !!b.imageUrl;
  if (!a.color || !b.color) return !a.color && !b.color;
  return colorDistance(a.color, b.color) <= COLOR_TOLERANCE;
}

function heightMatch(ha, hb) {
  const a = Number(ha) || 0;
  const b = Number(hb) || 0;
  const taller = Math.max(a, b);
  if (taller === 0) return true;
  return Math.abs(a - b) / taller <= HEIGHT_TOLERANCE;
}

export function scoreBlueprintFidelity(original, clone) {
  const a = Array.isArray(original?.bands) ? original.bands : [];
  const b = Array.isArray(clone?.bands) ? clone.bands : [];
  const aligned = Math.min(a.length, b.length);
  const unmatchedBands = Math.abs(a.length - b.length);
  const bands = [];
  let matched = 0;
  for (let i = 0; i < aligned; i++) {
    const checks = {
      role: a[i].role === b[i].role,
      background: backgroundMatch(a[i].background, b[i].background),
      columns: (a[i].columns || 1) === (b[i].columns || 1),
      media: (a[i].media?.kind || 'none') === (b[i].media?.kind || 'none'),
      height: heightMatch(a[i].bounds?.h, b[i].bounds?.h),
    };
    const hits = Object.values(checks).filter(Boolean).length;
    matched += hits;
    bands.push({ index: i, original: a[i].role, clone: b[i].role, checks, matched: hits });
  }
  const total = CHECKS * (aligned + unmatchedBands);
  return {
    score: total === 0 ? null : Math.round((100 * matched) / total),
    matched,
    total,
    aligned,
    unmatchedBands,
    bands,
  };
}
