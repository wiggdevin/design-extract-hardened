import { parseCornerRadii, computeObservedRadii } from './borders.js';

// Role weights for the global rollup — a button's corners describe the
// system far more reliably than a decorative dot's, so a foundation role's
// vote counts for more even at equal element counts.
export const ROLE_MULTIPLIER = {
  button: 1.25, input: 1.2, card: 1.15, navigation: 1.1, section: 1,
  media: 0.7, text: 0.5, avatar: 0.2, badge: 0.2, decorative: 0.1, unknown: 0.35,
};

// Only these roles can move the site-wide "global" verdict. Everything else
// (avatars, badges, media, decorative dots, text, unknown) stays role-local.
// Controls decide; page containers (nav, sections) are 0px on nearly every
// site and would otherwise swamp the vote, so they only speak when a page
// has no control evidence at all.
const FOUNDATION_ROLES = ['button', 'input', 'card'];
const CONTAINER_FALLBACK_ROLES = ['navigation', 'section'];

const MARGIN_THRESHOLD = 0.15;

// Inline text tags never own a control: a <span class="btn-label"> inside a
// pill button reports 0px corners and would outvote the button it sits in.
const INLINE_TEXT_TAGS = new Set(['span', 'i', 'b', 'em', 'strong', 'small', 'sup', 'sub', 'u', 's', 'abbr', 'code', 'time']);

// Class names carry their meaning in tokens, but CSS modules, BEM and
// camelCase glue those tokens to hashes and modifiers: "Card_bgWhite",
// "GkoSzG_panel", "Section__cta", "customerCard". A \b boundary never fires
// next to an underscore, so split on underscores and case changes as well
// as punctuation, and match rules against the token list.
export function classTokens(classList) {
  const raw = Array.isArray(classList) ? classList.join(' ') : String(classList || '');
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ');
}

// Form fields are fields whatever their class says (monzo.com's
// <select class="SelectMenu_select">, a search <input class="nav-search__input">).
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);
const FIELD_ROLES = new Set(['textbox', 'searchbox']);
// Toggles are small boxes whose corners say nothing about the field system
// (mercury.com's one 20px checkbox outvoted its pill email field). They stay
// role-local like a badge.
const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch']);

// A link that paints its own box, has horizontal padding, and sits in a
// control's size range is a button whatever its class says (Framer and
// Tailwind sites carry no button token: hyper.foundation, mercury.com).
const BUTTON_MIN_HEIGHT = 24;
const BUTTON_MAX_HEIGHT = 96;
const BUTTON_MAX_WIDTH = 640;
function isButtonShapedLink(el) {
  if (el.paddingLeft == null || el.width == null || el.height == null) return false;
  if ((parseFloat(el.paddingLeft) || 0) < 8) return false;
  if (el.height < BUTTON_MIN_HEIGHT || el.height > BUTTON_MAX_HEIGHT || el.width > BUTTON_MAX_WIDTH) return false;
  return paintsBox(el);
}
// Prose and headings never own a control or a card, however they are classed.
const PROSE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// A link that carries a Button component's class but paints no fill and has
// no horizontal padding is a text link (monzo.com's Button_link-underline).
// Records without paint or padding fields (older fixtures) keep the class verdict.
function isTextStyledLink(el) {
  if (el.paddingLeft == null && el.backgroundColor == null) return false;
  const padding = parseFloat(el.paddingLeft) || 0;
  if (padding >= 8) return false;
  const bg = el.backgroundColor;
  if (bg && !TRANSPARENT_RE.test(String(bg).trim())) return false;
  if (el.boxShadow && el.boxShadow !== 'none') return false;
  if (el.backgroundImage && el.backgroundImage !== 'none') return false;
  return true;
}

export function inferOwner(el = {}) {
  // Records may carry classList as an array (older captures, fixtures);
  // extractBorders now depends on this function, so it must never throw.
  const { tag = '', role = '', classList = '' } = el || {};
  const t = String(tag || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  const classes = classTokens(classList);
  const hasClass = re => re.test(classes);

  // Explicit ARIA role wins over a generic <div> tag.
  if (r === 'button') return 'button';
  if (FIELD_ROLES.has(r)) return 'input';
  if (TOGGLE_ROLES.has(r)) return 'badge';
  if (r === 'navigation' || r === 'banner' || r === 'contentinfo') return 'navigation';
  if (r === 'img') return 'media';

  if (t === 'path' || t === 'g' || t === 'use') return 'decorative';
  if (FIELD_TAGS.has(t)) return 'input';
  if (PROSE_TAGS.has(t)) return 'text';

  // Class tokens are usually a stronger signal than a bare <div>/<span>.
  // Badges, avatars and decorative dots are legitimately spans with their
  // own box; a control (button, card) never is — an inline tag carrying a
  // button class is the label inside the button, so it stays text.
  if (hasClass(/\b(avatar|profile)\b/)) return 'avatar';
  if (hasClass(/\b(badge|chip|pill|tag)\b/)) return 'badge';
  if (hasClass(/\b(icon|decor|blob|dot|glow|shine|overlay|backdrop)\b/)) return 'decorative';
  if (INLINE_TEXT_TAGS.has(t)) return 'text';
  if (hasClass(/\b(btn|button|cta)\b/)) return t !== 'button' && isTextStyledLink(el) ? 'text' : 'button';
  if (hasClass(/\b(card|cards|tile|panel)\b/)) return 'card';
  // A <button>, or a link shaped like one, is a control even when its class
  // names the menu or section it sits in (spline.design's
  // "InteractiveSection__framework" buttons, "Menu__trigger" buttons).
  if (t === 'button') return 'button';
  if (t === 'a' && isButtonShapedLink(el)) return 'button';
  if (hasClass(/\b(nav|menu)\b/)) return 'navigation';
  if (hasClass(/\b(hero|section|container)\b/)) return 'section';
  if (t === 'img' || t === 'picture' || t === 'video' || t === 'svg' || t === 'canvas') return 'media';
  if (t === 'nav' || t === 'header' || t === 'footer') return 'navigation';
  if (t === 'section' || t === 'main' || t === 'article') return 'section';
  if (/^h[1-6]$/.test(t) || t === 'p' || t === 'li' || t === 'span' || t === 'a') return 'text';

  return 'unknown';
}

// A corner "counts" as round enough for pill/circle once it clears half the
// box's short side in px, or 50% in percent terms — the two units aren't
// comparable so each is checked in its own space.
function isRoundCorner(value, unit, halfMinDim) {
  if (unit === '%') return value >= 50;
  return halfMinDim != null && value >= halfMinDim;
}

// Sub-3px radii read as sharp corners on screen (emmalewisham.co.uk and
// opusonewinery.com ship 2px buttons that every reviewer called square).
const SQUARE_TOLERANCE_PX = 2;

export function classifyGeometry({ corners = [0, 0, 0, 0], units = ['px', 'px', 'px', 'px'], width = 0, height = 0 } = {}) {
  if (corners.every((c, i) => c === 0 || (units[i] !== '%' && c <= SQUARE_TOLERANCE_PX))) return 'square';

  const hasDims = width > 0 && height > 0;
  const halfMinDim = hasDims ? Math.min(width, height) / 2 : null;
  const roundEnough = corners.some((c, i) => isRoundCorner(c, units[i], halfMinDim));
  const dimsClose = hasDims && Math.abs(width - height) <= 0.1 * Math.max(width, height);

  if (dimsClose && roundEnough) return 'circle';

  const isPill = roundEnough || corners.some((c, i) => units[i] !== '%' && c >= 100);
  return isPill ? 'pill' : 'rounded';
}

// Each element votes with a size weight, so a page's 15 large CTAs are not
// tied by 12 small variant toggles (liveaevi.com read "mixed" on a head
// count). The weight is the box's side length, clamped so a full-screen
// overlay <button> cannot swamp a role and a 1px box still counts.
const MIN_VOTE_WEIGHT = 16;
const MAX_VOTE_WEIGHT = 320;
function voteWeight(area) {
  const side = Math.sqrt(Math.max(0, area || 0));
  return Math.min(MAX_VOTE_WEIGHT, Math.max(MIN_VOTE_WEIGHT, side));
}

function tallyByValue(elements) {
  const tally = new Map();
  for (const { value, area } of elements) {
    const t = tally.get(value) || { value, count: 0, areaSum: 0, weight: 0 };
    t.count++;
    t.areaSum += area || 0;
    t.weight += voteWeight(area);
    tally.set(value, t);
  }
  return [...tally.values()];
}

// A SemanticDecision for one owner: which geometry value its elements agree
// on, how strongly, and what else was in the running.
function decideForOwner(owner, elements) {
  const totalCount = elements.length;
  const multiplier = ROLE_MULTIPLIER[owner] ?? 0.35;
  // A circular icon button is pill geometry for a control system; circle
  // stays meaningful only for avatars and media.
  const controlRole = FOUNDATION_ROLES.includes(owner);
  const normalized = controlRole ? elements.map(e => (e.value === 'circle' ? { ...e, value: 'pill' } : e)) : elements;
  const tally = tallyByValue(normalized);
  const totalWeight = tally.reduce((sum, t) => sum + t.weight, 0);
  const ranked = tally
    .map(t => ({ ...t, share: t.weight / totalWeight }))
    .sort((a, b) => b.share - a.share || b.areaSum - a.areaSum);

  const winner = ranked[0];
  const second = ranked[1];
  const margin = second ? winner.share - second.share : 1;
  const isMixed = Boolean(second) && margin < MARGIN_THRESHOLD;

  const reasons = [`${winner.count}/${totalCount} ${owner} elements use ${winner.value} corners (${Math.round(winner.share * 100)}% by size)`];
  if (isMixed) {
    reasons.push(`margin to ${second.value} is ${(margin * 100).toFixed(1)}%, below the ${MARGIN_THRESHOLD * 100}% decision threshold`);
  }

  return {
    value: isMixed ? 'mixed' : winner.value,
    confidence: Number((isMixed ? margin : Math.min(1, winner.share * multiplier)).toFixed(3)),
    coverage: Number(winner.share.toFixed(3)),
    reasons,
    alternatives: ranked.slice(1).map(r => ({ value: r.value, score: Number(r.share.toFixed(3)), reason: `${r.count}/${totalCount} ${owner} elements` })),
  };
}

// Global is a weighted vote across foundation-role elements only — a lone
// pill badge or circular avatar can never move it, by construction (they
// are simply not in this pool). Circle collapses to pill: a system-wide
// verdict only distinguishes square/rounded/pill.
function decideGlobal(byOwnerElements) {
  const weighted = new Map();
  let totalWeight = 0;
  let evidenceRoles = FOUNDATION_ROLES.filter(owner => (byOwnerElements.get(owner) || []).length > 0);
  let basis = 'control roles';
  if (evidenceRoles.length === 0) {
    evidenceRoles = CONTAINER_FALLBACK_ROLES.filter(owner => (byOwnerElements.get(owner) || []).length > 0);
    basis = 'container roles only (no button, input, or card evidence)';
  }

  // Each role votes with its share, not its element count: 55 rounded cards
  // must not drown 19 pill buttons just because a grid has more tiles.
  // Inside a role, elements carry the same size weight as in the role vote.
  for (const owner of evidenceRoles) {
    const elements = byOwnerElements.get(owner);
    const multiplier = ROLE_MULTIPLIER[owner] ?? 1;
    const roleWeight = elements.reduce((sum, e) => sum + voteWeight(e.area), 0);
    for (const { value, area } of elements) {
      const gv = value === 'circle' ? 'pill' : value;
      const w = weighted.get(gv) || { value: gv, weight: 0, areaSum: 0 };
      const share = multiplier * voteWeight(area) / roleWeight;
      w.weight += share;
      w.areaSum += area || 0;
      weighted.set(gv, w);
      totalWeight += share;
    }
  }

  if (evidenceRoles.length === 0) {
    return { value: null, confidence: 0, coverage: 0, reasons: ['no foundation-role evidence'], alternatives: [] };
  }

  const ranked = [...weighted.values()]
    .map(w => ({ ...w, share: w.weight / totalWeight }))
    .sort((a, b) => b.share - a.share || b.areaSum - a.areaSum);
  const winner = ranked[0];
  const second = ranked[1];
  const margin = second ? winner.share - second.share : 1;
  const isMixed = Boolean(second) && margin < MARGIN_THRESHOLD;

  const reasons = isMixed
    ? [`${basis} split between ${winner.value} and ${second.value} (margin ${(margin * 100).toFixed(1)}%)`]
    : [`${basis} favor ${winner.value} corners (${Math.round(winner.share * 100)}% weighted share)`];

  return {
    value: isMixed ? 'mixed' : winner.value,
    confidence: Number((isMixed ? margin : Math.min(1, winner.share)).toFixed(3)),
    coverage: Number(winner.share.toFixed(3)),
    reasons,
    alternatives: ranked.slice(1).map(r => ({ value: r.value, score: Number(r.share.toFixed(3)), reason: 'foundation-role weighted share' })),
  };
}

const TRANSPARENT_RE = /^(transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)|rgba\(\s*\d+\s+\d+\s+\d+\s*\/\s*0\s*\))$/i;

// Corners are only visible on a box that paints: a fill, a border, a shadow
// or a background image. An unstyled <button> around a text link has a
// radius in the DOM and nothing on screen. Records that carry none of the
// paint fields (older fixtures) are assumed to paint.
export function paintsBox(el) {
  const hasField = ['backgroundColor', 'borderWidth', 'boxShadow', 'backgroundImage'].some(k => el[k] != null);
  if (!hasField) return true;
  const bg = el.backgroundColor;
  if (bg && !TRANSPARENT_RE.test(String(bg).trim())) return true;
  if (el.borderWidth && /[1-9]/.test(String(el.borderWidth))) return true;
  if (el.boxShadow && el.boxShadow !== 'none') return true;
  if (el.backgroundImage && el.backgroundImage !== 'none') return true;
  return false;
}

export function extractGeometrySystem(computedStyles = []) {
  const byOwnerElements = new Map();

  for (const el of computedStyles) {
    if (!el || !el.borderRadius) continue;
    // Zero-size boxes paint nothing; their corners are not visible evidence.
    // (Records without dimensions, e.g. older fixtures, still vote.)
    if (el.width === 0 || el.height === 0) continue;
    if (!paintsBox(el)) continue;
    const { corners, units } = parseCornerRadii(el.borderRadius);
    const owner = inferOwner(el);
    const value = classifyGeometry({ corners, units, width: el.width, height: el.height });
    const area = typeof el.area === 'number' ? el.area : (el.width || 0) * (el.height || 0);
    if (!byOwnerElements.has(owner)) byOwnerElements.set(owner, []);
    byOwnerElements.get(owner).push({ value, area });
  }

  const byRole = {};
  for (const [owner, elements] of byOwnerElements) {
    byRole[owner] = decideForOwner(owner, elements);
  }

  return {
    global: decideGlobal(byOwnerElements),
    byRole,
    observed: computeObservedRadii(computedStyles),
  };
}
