// Section blueprint: the page as an ordered list of full-width bands with
// role, background, columns, media, heading, and reveal motion. Input is the
// band records from the crawler's geometry walk (collectPageData → bands) and
// the normalized runtime motion observations. Pure; no DOM access.
import { classifyRole } from './section-roles.js';

const OVERSIZED_SHARE = 0.8;
const HERO_MEDIA_SHARE = 0.4;
const HERO_HEADING_PX = 40;
const HERO_WITHIN_VIEWPORTS = 1.5;

function revealFor(band, observations) {
  const top = band.bounds.y;
  const bottom = top + band.bounds.h;
  for (const o of observations) {
    if (!o || o.trigger !== 'scroll' || typeof o.top !== 'number') continue;
    if (o.top < top || o.top >= bottom) continue;
    const props = new Set(o.properties || []);
    let kind = null;
    if (props.has('transform') && !props.has('opacity')) kind = 'parallax';
    else if (props.has('position') || (o.name || '').includes('pin')) kind = 'pin';
    else if (props.has('opacity')) kind = 'reveal';
    if (!kind) continue;
    return { kind, durationMs: Number(o.duration) || 0, easing: o.easing || 'linear' };
  }
  return null;
}

export function extractBlueprint(bands = [], runtimeObservations = [], pageIntent = null, { pageHeight = 0, viewportHeight = 800 } = {}) {
  const valid = (Array.isArray(bands) ? bands : []).filter(b => b && b.bounds && Number.isFinite(b.bounds.y) && Number.isFinite(b.bounds.h));
  const totalHeight = pageHeight || Math.max(0, ...valid.map(b => b.bounds.y + b.bounds.h));
  const kept = [];
  let oversizedDropped = 0;
  for (const b of valid) {
    if (totalHeight > 0 && b.bounds.h > totalHeight * OVERSIZED_SHARE) { oversizedDropped++; continue; }
    kept.push(b);
  }
  kept.sort((a, b) => a.bounds.y - b.bounds.y);

  const heroCandidate = kept.findIndex(b => b.bounds.y <= viewportHeight * HERO_WITHIN_VIEWPORTS
    && (((b.media && b.media.share) || 0) >= HERO_MEDIA_SHARE || ((b.heading && b.heading.fontSize) || 0) >= HERO_HEADING_PX));

  const pageType = pageIntent && pageIntent.type;
  const observations = Array.isArray(runtimeObservations) ? runtimeObservations : [];
  const out = kept.map((b, i) => {
    const classified = classifyRole({
      tag: b.tag, role: b.role, className: b.className, id: b.id, position: b.position,
      text: b.text || '', headings: b.heading && b.heading.text ? [b.heading.text] : [],
      buttonCount: b.buttonCount || 0, cardCount: b.cardCount || 0, bounds: b.bounds,
      heroCandidate: i === heroCandidate,
    }, null, pageType);
    return {
      index: i,
      role: classified.role,
      confidence: Number((classified.confidence || 0).toFixed(3)),
      tag: b.tag, className: b.className || '', id: b.id || '', position: b.position || 'static',
      bounds: b.bounds,
      background: b.background || { color: null, imageUrl: null, hasVideo: false },
      columns: b.columns || 1,
      media: b.media || { kind: 'none', share: 0, src: null },
      heading: b.heading || null,
      textLength: b.textLength || 0,
      buttonCount: b.buttonCount || 0,
      cardCount: b.cardCount || 0,
      reveal: revealFor(b, observations),
    };
  });

  const byRole = {};
  for (const b of out) byRole[b.role] = (byRole[b.role] || 0) + 1;
  return {
    bands: out,
    readingOrder: out.map(b => b.role),
    heroIndex: out.findIndex(b => b.role === 'hero'),
    counts: { bands: out.length, oversizedDropped, byRole },
  };
}
