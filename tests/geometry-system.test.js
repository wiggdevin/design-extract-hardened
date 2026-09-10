import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBorders, parseCornerRadii } from '../src/extractors/borders.js';
import { inferOwner, classifyGeometry, extractGeometrySystem, paintsBox } from '../src/extractors/geometry-system.js';
import { extractMaterialLanguage } from '../src/extractors/material-language.js';

// ── Shared fixture factory ──────────────────────────────────────

function makeEl(overrides = {}) {
  return {
    tag: 'div',
    classList: '',
    role: '',
    area: 10000,
    width: 100,
    height: 100,
    borderRadius: '0px',
    ...overrides,
  };
}

// ── parseCornerRadii ────────────────────────────────────────────

describe('parseCornerRadii', () => {
  it('expands a single value to all four corners', () => {
    assert.deepEqual(parseCornerRadii('8px'), { corners: [8, 8, 8, 8], units: ['px', 'px', 'px', 'px'] });
  });

  it('expands two values as tl/br, tr/bl', () => {
    assert.deepEqual(parseCornerRadii('4px 8px'), { corners: [4, 8, 4, 8], units: ['px', 'px', 'px', 'px'] });
  });

  it('preserves four asymmetric corners in clockwise order', () => {
    assert.deepEqual(parseCornerRadii('0px 8px 0px 8px'), { corners: [0, 8, 0, 8], units: ['px', 'px', 'px', 'px'] });
  });

  it('expands three values as tl, tr/bl, br', () => {
    assert.deepEqual(parseCornerRadii('2px 4px 6px'), { corners: [2, 4, 6, 4], units: ['px', 'px', 'px', 'px'] });
  });

  it('keeps percent values as percent, never converts to px', () => {
    assert.deepEqual(parseCornerRadii('50%'), { corners: [50, 50, 50, 50], units: ['%', '%', '%', '%'] });
  });

  it('takes the horizontal radii from slash (elliptical) syntax', () => {
    assert.deepEqual(parseCornerRadii('8px / 4px'), { corners: [8, 8, 8, 8], units: ['px', 'px', 'px', 'px'] });
  });

  it('keeps zero corners', () => {
    assert.deepEqual(parseCornerRadii('0px'), { corners: [0, 0, 0, 0], units: ['px', 'px', 'px', 'px'] });
  });

  it('reads scientific-notation radii instead of collapsing them to zero', () => {
    // n26.com computes 3.35544e+07px on its pill buttons.
    const r = parseCornerRadii('3.35544e+07px');
    assert.equal(r.corners[0], 33554400);
    assert.equal(classifyGeometry({ corners: r.corners, units: r.units, width: 160, height: 48 }), 'pill');
  });

  it('never throws on a non-string classList, so extractBorders keeps its inventory', () => {
    // A single array-valued classList used to crash inferOwner and, through
    // computeObservedRadii, wipe the whole borders result for the page.
    const styles = [
      makeEl({ tag: 'div', classList: 'btn', borderRadius: '8px', width: 100, height: 40 }),
      makeEl({ tag: 'div', classList: ['weird', 'array'], borderRadius: '4px', width: 50, height: 50 }),
      makeEl({ tag: 'div', classList: 42, role: null, borderRadius: '2px' }),
    ];
    const borders = extractBorders(styles);
    assert.ok(borders.radii.some(r => r.value === 8));
    assert.equal(inferOwner({ tag: 'span', classList: ['badge'] }), 'badge');
    assert.doesNotThrow(() => extractGeometrySystem(styles));
  });
});

// ── inferOwner ──────────────────────────────────────────────────

describe('inferOwner', () => {
  it('classifies a <button> tag as button', () => {
    assert.equal(inferOwner({ tag: 'button', role: '', classList: '' }), 'button');
  });

  it('classifies an <input> tag as input', () => {
    assert.equal(inferOwner({ tag: 'input', role: '', classList: '' }), 'input');
  });

  it('classifies a card class token as card', () => {
    assert.equal(inferOwner({ tag: 'div', role: '', classList: 'product-card shadow' }), 'card');
  });

  it('classifies an avatar class token as avatar', () => {
    assert.equal(inferOwner({ tag: 'div', role: '', classList: 'user-avatar' }), 'avatar');
  });

  it('classifies a badge/chip/pill class token as badge', () => {
    assert.equal(inferOwner({ tag: 'span', role: '', classList: 'status-badge' }), 'badge');
  });

  it('classifies a <nav> tag as navigation', () => {
    assert.equal(inferOwner({ tag: 'nav', role: '', classList: '' }), 'navigation');
  });

  it('classifies role=navigation as navigation', () => {
    assert.equal(inferOwner({ tag: 'div', role: 'navigation', classList: '' }), 'navigation');
  });

  it('classifies a <section> tag as section', () => {
    assert.equal(inferOwner({ tag: 'section', role: '', classList: '' }), 'section');
  });

  it('classifies heading/paragraph tags as text', () => {
    assert.equal(inferOwner({ tag: 'h1', role: '', classList: '' }), 'text');
    assert.equal(inferOwner({ tag: 'p', role: '', classList: '' }), 'text');
  });

  it('classifies a plain div with no signal as unknown', () => {
    assert.equal(inferOwner({ tag: 'div', role: '', classList: '' }), 'unknown');
  });

  it('classifies media tags as media', () => {
    assert.equal(inferOwner({ tag: 'img', role: '', classList: '' }), 'media');
    assert.equal(inferOwner({ tag: 'svg', role: '', classList: '' }), 'media');
  });
});

// ── classifyGeometry ────────────────────────────────────────────

describe('classifyGeometry', () => {
  it('classifies all-zero corners as square', () => {
    assert.equal(classifyGeometry({ corners: [0, 0, 0, 0], units: ['px', 'px', 'px', 'px'], width: 100, height: 40 }), 'square');
  });

  it('classifies a 50% radius on a near-square box as circle', () => {
    assert.equal(classifyGeometry({ corners: [50, 50, 50, 50], units: ['%', '%', '%', '%'], width: 48, height: 48 }), 'circle');
  });

  it('classifies a large radius on a non-square box as pill', () => {
    assert.equal(classifyGeometry({ corners: [9999, 9999, 9999, 9999], units: ['px', 'px', 'px', 'px'], width: 120, height: 44 }), 'pill');
  });

  it('classifies a small radius as rounded', () => {
    assert.equal(classifyGeometry({ corners: [8, 8, 8, 8], units: ['px', 'px', 'px', 'px'], width: 200, height: 120 }), 'rounded');
  });

  it('classifies px radius >= 100 as pill even without dims', () => {
    assert.equal(classifyGeometry({ corners: [120, 120, 120, 120], units: ['px', 'px', 'px', 'px'], width: 0, height: 0 }), 'pill');
  });
});

// ── extractGeometrySystem ───────────────────────────────────────

describe('extractGeometrySystem', () => {
  it('yields a square global with a pill badge and circle avatar kept role-local', () => {
    const styles = [
      makeEl({ tag: 'button', classList: 'btn', width: 120, height: 44, borderRadius: '0px' }),
      makeEl({ tag: 'button', classList: 'btn', width: 120, height: 44, borderRadius: '0px' }),
      makeEl({ tag: 'div', classList: 'product-card', width: 300, height: 400, borderRadius: '0px' }),
      makeEl({ tag: 'input', width: 200, height: 40, borderRadius: '0px' }),
      makeEl({ tag: 'span', classList: 'status-badge', width: 60, height: 24, borderRadius: '9999px' }),
      makeEl({ tag: 'div', classList: 'user-avatar', width: 48, height: 48, borderRadius: '50%' }),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.global.value, 'square');
    assert.equal(result.byRole.badge.value, 'pill');
    assert.equal(result.byRole.avatar.value, 'circle');
    const zeroRecord = result.observed.find(r => r.corners.every(c => c === 0));
    assert.ok(zeroRecord, 'expected an all-zero corners record in observed');
  });

  it('yields a pill global for a pill-led button/input system', () => {
    const styles = [
      makeEl({ tag: 'button', classList: 'btn', width: 120, height: 44, borderRadius: '9999px' }),
      makeEl({ tag: 'button', classList: 'btn', width: 120, height: 44, borderRadius: '9999px' }),
      makeEl({ tag: 'input', width: 200, height: 40, borderRadius: '9999px' }),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.global.value, 'pill');
  });

  it('yields a null global when only avatars are present (no foundation evidence)', () => {
    const styles = [
      makeEl({ tag: 'div', classList: 'user-avatar', width: 48, height: 48, borderRadius: '50%' }),
      makeEl({ tag: 'div', classList: 'user-avatar', width: 32, height: 32, borderRadius: '50%' }),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.global.value, null);
    assert.ok(result.global.reasons.includes('no foundation-role evidence'));
  });

  it('keeps percent radii as percent in observed', () => {
    const styles = [
      makeEl({ tag: 'div', classList: 'user-avatar', width: 48, height: 48, borderRadius: '50%' }),
    ];
    const result = extractGeometrySystem(styles);
    const rec = result.observed.find(r => r.owner === 'avatar');
    assert.ok(rec);
    assert.equal(rec.unit, '%');
    assert.deepEqual(rec.corners, [50, 50, 50, 50]);
  });

  it('preserves asymmetric corners in observed', () => {
    const styles = [
      makeEl({ tag: 'div', classList: 'product-card', width: 300, height: 200, borderRadius: '0px 8px 0px 8px' }),
    ];
    const result = extractGeometrySystem(styles);
    const rec = result.observed.find(r => r.owner === 'card');
    assert.ok(rec);
    assert.deepEqual(rec.corners, [0, 8, 0, 8]);
  });

  it('handles elliptical slash-syntax radii', () => {
    const styles = [
      makeEl({ tag: 'div', classList: 'product-card', width: 300, height: 200, borderRadius: '8px / 4px' }),
    ];
    const result = extractGeometrySystem(styles);
    const rec = result.observed.find(r => r.owner === 'card');
    assert.ok(rec);
    assert.deepEqual(rec.corners, [8, 8, 8, 8]);
    assert.equal(rec.unit, 'px');
  });

  it('skips elements without a borderRadius entirely', () => {
    const styles = [
      { tag: 'div', classList: '', role: '', area: 100, width: 10, height: 10 }, // no borderRadius field
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.observed.length, 0);
    assert.equal(Object.keys(result.byRole).length, 0);
  });
});

// ── extractBorders (observed addition, existing contract intact) ──

describe('extractBorders with observed geometry', () => {
  const mockStyles = [
    makeEl({ tag: 'button', classList: 'btn', width: 120, height: 44, borderRadius: '4px', borderWidth: '1px', borderStyle: 'solid' }),
    makeEl({ tag: 'button', classList: 'btn', width: 120, height: 44, borderRadius: '4px', borderWidth: '1px', borderStyle: 'solid' }),
    makeEl({ tag: 'div', classList: 'product-card', width: 300, height: 400, borderRadius: '8px', borderWidth: '2px', borderStyle: 'solid' }),
    makeEl({ tag: 'div', classList: '', width: 50, height: 50, borderRadius: '9999px' }),
    makeEl({ tag: 'div', classList: '', width: 50, height: 50, borderRadius: '0px' }),
  ];

  it('keeps radii, widths, styles unchanged (value > 0 only)', () => {
    const borders = extractBorders(mockStyles);
    assert.ok('radii' in borders);
    for (const r of borders.radii) {
      assert.ok(r.value > 0);
    }
  });

  it('adds an observed field that includes the zero-radius element', () => {
    const borders = extractBorders(mockStyles);
    assert.ok(Array.isArray(borders.observed));
    const zeroRecord = borders.observed.find(r => r.corners.every(c => c === 0));
    assert.ok(zeroRecord, 'expected a zero-corner record in borders.observed');
  });

  it('caps observed at 200 entries and sorts by count desc', () => {
    const borders = extractBorders(mockStyles);
    assert.ok(borders.observed.length <= 200);
    for (let i = 1; i < borders.observed.length; i++) {
      assert.ok(borders.observed[i - 1].count >= borders.observed[i].count);
    }
  });
});

// ── material-language geometry-aware pill signal ───────────────

describe('extractMaterialLanguage with role-aware geometry', () => {
  const softShadows = { values: [{ value: '0 10px 40px rgba(0,0,0,0.15)' }, { value: '0 4px 20px rgba(0,0,0,0.1)' }] };
  const midSatColors = { all: [{ hex: '#3355ff' }, { hex: '#ffddee' }] };

  it('does not produce material-you from a lone pill badge when global geometry is square', () => {
    const design = {
      colors: midSatColors,
      shadows: softShadows,
      gradients: { count: 0 },
      borders: {
        radii: [9999],
        geometry: {
          global: { value: 'square', confidence: 0.9, coverage: 1, reasons: [], alternatives: [] },
          byRole: { badge: { value: 'pill', confidence: 0.2, coverage: 1, reasons: [], alternatives: [] } },
          observed: [],
        },
      },
    };
    const r = extractMaterialLanguage(design);
    assert.notEqual(r.label, 'material-you');
    assert.equal(r.metrics.geometrySource, 'role-aware');
  });

  it('produces material-you when the button role is pill', () => {
    const design = {
      colors: midSatColors,
      shadows: softShadows,
      gradients: { count: 0 },
      borders: {
        radii: [9999],
        geometry: {
          global: { value: 'pill', confidence: 0.9, coverage: 1, reasons: [], alternatives: [] },
          byRole: { button: { value: 'pill', confidence: 0.9, coverage: 1, reasons: [], alternatives: [] } },
          observed: [],
        },
      },
    };
    const r = extractMaterialLanguage(design);
    assert.equal(r.label, 'material-you');
    assert.equal(r.metrics.geometrySource, 'role-aware');
  });

  it('falls back to legacy numeric pill detection when geometry is absent', () => {
    const design = {
      colors: midSatColors,
      shadows: softShadows,
      gradients: { count: 0 },
      borders: { radii: [9999] },
    };
    const r = extractMaterialLanguage(design);
    assert.equal(r.label, 'material-you');
    assert.equal(r.metrics.geometrySource, 'legacy');
  });
});

// ── Live-site regressions (2026-09-09 benchmark) ────────────────
//
// wise.com: 135 <span class="btn-label"> inside pill buttons reported 0px and
// outvoted the 36 real 9999px buttons; zero-size 50% divs voted too; and page
// containers (0px on every site) swamped the global vote so 14/16 sites read
// "square". Each of these is a real capture, not a hypothetical.

describe('extractGeometrySystem — live-site regressions', () => {
  function makeElement(tag, classList, borderRadius, width, height) {
    return makeEl({ tag, classList, borderRadius, width, height, area: width * height });
  }

  it('does not let button-label spans outvote the pill buttons they sit in', () => {
    const styles = [
      ...Array.from({ length: 30 }, () => makeElement('span', 'btn-label', '0px', 187, 48)),
      ...Array.from({ length: 10 }, () => makeElement('a', 'btn btn-primary', '9999px', 188, 48)),
      ...Array.from({ length: 4 }, () => makeElement('button', 'btn', '9999px', 200, 48)),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(inferOwner({ tag: 'span', classList: 'btn-label' }), 'text');
    assert.equal(result.byRole.button.value, 'pill');
    assert.equal(result.global.value, 'pill');
  });

  it('still lets a span badge own its box', () => {
    assert.equal(inferOwner({ tag: 'span', classList: 'badge' }), 'badge');
    assert.equal(inferOwner({ tag: 'span', classList: 'avatar' }), 'avatar');
  });

  it('ignores zero-size elements when voting but keeps them in observed', () => {
    const styles = [
      ...Array.from({ length: 5 }, () => makeElement('button', '', '0px', 120, 40)),
      ...Array.from({ length: 20 }, () => makeElement('div', 'btn', '50%', 0, 0)),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.byRole.button.value, 'square');
    assert.ok(result.observed.some(o => o.unit === '%' && o.count === 20), 'zero-size records stay in observed');
  });

  it('derives global from controls, not from 0px page containers', () => {
    const styles = [
      ...Array.from({ length: 40 }, () => makeElement('section', '', '0px', 1280, 600)),
      ...Array.from({ length: 30 }, () => makeElement('nav', '', '0px', 1280, 64)),
      ...Array.from({ length: 12 }, () => makeElement('button', '', '128px', 160, 48)),
      ...Array.from({ length: 4 }, () => makeElement('div', 'card', '9999px', 300, 200)),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.global.value, 'pill');
    assert.match(result.global.reasons[0], /control roles/);
  });

  it('votes per role, not per element: 55 rounded cards do not drown 19 pill buttons', () => {
    // apple.com/macbook-neo. Pill buttons with rounded cards is a genuinely
    // split control system, so the honest global is mixed, and the button
    // role still reports pill on its own.
    const styles = [
      ...Array.from({ length: 19 }, () => makeElement('button', '', '980px', 120, 40)),
      ...Array.from({ length: 55 }, () => makeElement('div', 'card', '28px', 400, 300)),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.byRole.button.value, 'pill');
    assert.equal(result.byRole.card.value, 'rounded');
    assert.equal(result.global.value, 'mixed');
    assert.ok(result.global.alternatives.length >= 1);
  });

  it('reads sub-3px corners as square and circular icon buttons as pill', () => {
    assert.equal(classifyGeometry({ corners: [2, 2, 2, 2], units: ['px', 'px', 'px', 'px'], width: 160, height: 48 }), 'square');
    assert.equal(classifyGeometry({ corners: [3, 3, 3, 3], units: ['px', 'px', 'px', 'px'], width: 160, height: 48 }), 'rounded');
    const styles = [
      ...Array.from({ length: 14 }, () => makeElement('button', '', '50%', 36, 36)),
      ...Array.from({ length: 5 }, () => makeElement('button', '', '980px', 120, 40)),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.byRole.button.value, 'pill');
  });

  it('falls back to container roles only when no control evidence exists', () => {
    const styles = Array.from({ length: 10 }, () => makeElement('section', '', '0px', 1280, 600));
    const result = extractGeometrySystem(styles);
    assert.equal(result.global.value, 'square');
    assert.match(result.global.reasons[0], /container roles only/);
  });

  it('ignores unpainted boxes: an unstyled button wrapper around a text link has no visible corners', () => {
    // apple.com/macbook-neo: 53 of 80 button elements were transparent,
    // borderless wrappers at 0px; the visible CTAs are painted pills.
    const unpainted = { backgroundColor: 'rgba(0, 0, 0, 0)', borderWidth: '0px', boxShadow: 'none', backgroundImage: 'none' };
    const painted = { backgroundColor: 'rgb(0, 0, 0)', borderWidth: '0px', boxShadow: 'none', backgroundImage: 'none' };
    const styles = [
      ...Array.from({ length: 50 }, () => makeEl({ tag: 'button', borderRadius: '0px', width: 120, height: 40, ...unpainted })),
      ...Array.from({ length: 20 }, () => makeEl({ tag: 'button', borderRadius: '980px', width: 120, height: 40, ...painted })),
      makeEl({ tag: 'button', borderRadius: '0px', width: 120, height: 40, backgroundColor: 'transparent', borderWidth: '1px', boxShadow: 'none', backgroundImage: 'none' }),
    ];
    const result = extractGeometrySystem(styles);
    assert.equal(result.byRole.button.value, 'pill');
    assert.equal(result.global.value, 'pill');
    assert.equal(paintsBox({ backgroundColor: 'transparent', borderWidth: '0px', boxShadow: 'none', backgroundImage: 'none' }), false);
    assert.equal(paintsBox({ backgroundColor: 'transparent', borderWidth: '0px', boxShadow: '0 1px 2px rgba(0,0,0,.2)', backgroundImage: 'none' }), true);
    assert.equal(paintsBox({ tag: 'div', borderRadius: '8px' }), true, 'records without paint fields still vote');
  });
});
