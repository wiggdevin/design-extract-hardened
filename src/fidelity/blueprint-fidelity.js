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
  const x = a && typeof a === 'object' ? a : {};
  const y = b && typeof b === 'object' ? b : {};
  if (x.hasVideo || y.hasVideo) return !!x.hasVideo && !!y.hasVideo;
  if (x.imageUrl || y.imageUrl) return !!x.imageUrl && !!y.imageUrl;
  if (!x.color || !y.color) return !x.color && !y.color;
  return colorDistance(x.color, y.color) <= COLOR_TOLERANCE;
}

function heightMatch(ha, hb) {
  const a = Number(ha) || 0;
  const b = Number(hb) || 0;
  const taller = Math.max(a, b);
  if (taller === 0) return true;
  return Math.abs(a - b) / taller <= HEIGHT_TOLERANCE;
}

export function scoreBlueprintFidelity(original, clone) {
  const a = (Array.isArray(original?.bands) ? original.bands : []).filter((b) => !(b && b.overlay));
  const b = (Array.isArray(clone?.bands) ? clone.bands : []).filter((b) => !(b && b.overlay));
  const aligned = Math.min(a.length, b.length);
  const unmatchedBands = Math.abs(a.length - b.length);
  const bands = [];
  let matched = 0;
  for (let i = 0; i < aligned; i++) {
    const aBand = a[i] && typeof a[i] === 'object' ? a[i] : {};
    const bBand = b[i] && typeof b[i] === 'object' ? b[i] : {};
    const checks = {
      role: aBand.role === bBand.role,
      background: backgroundMatch(aBand.background, bBand.background),
      columns: (aBand.columns || 1) === (bBand.columns || 1),
      media: (aBand.media?.kind || 'none') === (bBand.media?.kind || 'none'),
      height: heightMatch(aBand.bounds?.h, bBand.bounds?.h),
    };
    const hits = Object.values(checks).filter(Boolean).length;
    matched += hits;
    bands.push({ index: i, original: aBand.role, clone: bBand.role, checks, matched: hits });
  }
  const total = CHECKS * (aligned + unmatchedBands);
  return {
    score: total === 0 ? null : Math.round((100 * matched) / total),
    matched,
    total,
    aligned,
    unmatchedBands,
    // A band-count mismatch shifts every band after the first missing one
    // out of alignment, so the per-band checks below it compare unrelated
    // bands rather than a true build fault. driftSuspected flags that.
    driftSuspected: unmatchedBands > 0,
    bands,
  };
}
