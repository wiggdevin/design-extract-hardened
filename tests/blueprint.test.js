import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlueprint, stripBandText } from '../src/extractors/blueprint.js';
import { classifyRole } from '../src/extractors/section-roles.js';

const band = (over) => ({
  tag: 'div', role: '', className: 'fusion-fullwidth', id: '', position: 'static',
  bounds: { x: 0, y: 0, w: 1280, h: 600 },
  background: { color: '#ffffff', imageUrl: null, hasVideo: false },
  columns: 1, media: { kind: 'none', share: 0, src: null }, heading: null,
  text: '', textLength: 0, buttonCount: 0, cardCount: 0, repeats: null, ...over,
});

// Shaped after the odysseycontracting.com capture (20,564 px tall at 1280 wide).
const odyssey = [
  band({ tag: 'header', className: 'fusion-header-wrapper', bounds: { x: 0, y: 0, w: 1280, h: 107 }, background: { color: '#0f2a44', imageUrl: null, hasVideo: false }, text: 'Services About Contact', textLength: 22, buttonCount: 1 }),
  band({ tag: 'main', id: 'main', bounds: { x: 0, y: 107, w: 1280, h: 20300 }, text: 'Odyssey vs the rest. Get started. $ 10 per month', textLength: 12000, cardCount: 40 }),
  band({ className: 'fusion-fullwidth hero-band', bounds: { x: 0, y: 107, w: 1280, h: 820 }, media: { kind: 'photo', share: 0.72, src: 'https://odysseycontracting.com/wp-content/uploads/hero.jpg' }, heading: { level: 1, fontSize: 52, text: 'Building homes that last' }, text: 'Building homes that last. Get a quote', textLength: 40, buttonCount: 1 }),
  band({ className: 'fusion-fullwidth', bounds: { x: 0, y: 927, w: 1280, h: 900 }, columns: 2, media: { kind: 'photo', share: 0.45, src: 'https://odysseycontracting.com/wp-content/uploads/kitchen.jpg' }, heading: { level: 2, fontSize: 36, text: 'Kitchens' }, text: 'Kitchens. Bathrooms. Our services', textLength: 300, cardCount: 2 }),
  band({ className: 'fusion-fullwidth', bounds: { x: 0, y: 1827, w: 1280, h: 700 }, background: { color: '#0f2a44', imageUrl: null, hasVideo: false }, heading: { level: 2, fontSize: 36, text: 'What clients say' }, text: '"They finished on time and the kitchen is stunning" — Jane Doe. "Great crew" — John Roe', textLength: 200, cardCount: 3 }),
  band({ tag: 'nav', className: 'fusion-footer-menu', bounds: { x: 0, y: 19378, w: 1280, h: 197 }, text: 'Privacy Terms Sitemap', textLength: 21 }),
  band({ tag: 'footer', bounds: { x: 0, y: 19575, w: 1280, h: 989 }, background: { color: '#0f2a44', imageUrl: null, hasVideo: false }, text: 'Copyright', textLength: 9 }),
];

const observations = [
  { trigger: 'scroll', selector: 'div.fusion-layout-column:nth-of-type(1)', properties: ['opacity', 'transform'], duration: 600, easing: 'ease-out', top: 990, height: 400 },
  { trigger: 'scroll', selector: 'div.parallax', properties: ['transform'], duration: 0, easing: 'linear', top: 1900, height: 300 },
  { trigger: 'hover', selector: 'a.fusion-button', properties: ['background-color'], duration: 200, easing: 'ease', top: 500, height: 40 },
];

describe('extractBlueprint on the reference records', () => {
  const bp = extractBlueprint(odyssey, observations, { type: 'landing' }, { pageHeight: 20564, viewportHeight: 800 });

  it('drops the whole-page container and counts it', () => {
    assert.equal(bp.counts.oversizedDropped, 1);
    assert.ok(!bp.bands.some(b => b.tag === 'main'));
    assert.ok(!bp.readingOrder.includes('comparison'));
  });

  it('puts nav first and the hero second', () => {
    assert.equal(bp.readingOrder[0], 'nav');
    assert.equal(bp.readingOrder[1], 'hero');
    assert.equal(bp.heroIndex, 1);
  });

  it('classifies at most one nav: the footer menu is not nav', () => {
    assert.equal(bp.readingOrder.filter(r => r === 'nav').length, 1);
    assert.equal(bp.bands.find(b => b.className === 'fusion-footer-menu').role !== 'nav', true);
  });

  it('keeps the footer, the testimonial band, and the counts', () => {
    assert.equal(bp.readingOrder[bp.readingOrder.length - 1], 'footer');
    assert.ok(bp.readingOrder.includes('testimonial'));
    assert.equal(bp.counts.bands, 6);
    assert.equal(bp.counts.byRole.nav, 1);
  });

  it('attaches a reveal from a scroll observation inside the band box', () => {
    const services = bp.bands.find(b => b.columns === 2);
    assert.deepEqual(services.reveal, { kind: 'reveal', durationMs: 600, easing: 'ease-out' });
    const reviews = bp.bands.find(b => b.heading && b.heading.text === 'What clients say');
    assert.deepEqual(reviews.reveal, { kind: 'parallax', durationMs: 0, easing: 'linear' });
    assert.equal(bp.bands[0].reveal, null, 'hover observations never become reveals');
  });

  it('strips the classifier text from the output but keeps the heading and lengths', () => {
    for (const b of bp.bands) assert.equal('text' in b, false);
    assert.equal(bp.bands[1].heading.text, 'Building homes that last');
    assert.equal(bp.bands[1].textLength, 40);
    assert.equal(bp.bands[1].media.src, 'https://odysseycontracting.com/wp-content/uploads/hero.jpg');
  });

  it('returns an empty blueprint for no bands', () => {
    assert.deepEqual(extractBlueprint([], [], null), { bands: [], readingOrder: [], heroIndex: -1, counts: { bands: 0, oversizedDropped: 0, byRole: {} } });
  });
});

describe('classifyRole rule changes', () => {
  it('a nav tag far down the page with static position is not nav', () => {
    const r = classifyRole({ tag: 'nav', className: 'fusion-footer-menu', text: 'Privacy Terms', headings: [], bounds: { y: 19378, h: 197 }, position: 'static' }, null, 'landing');
    assert.notEqual(r.role, 'nav');
  });

  it('a fixed nav anywhere is nav; a header near the top is nav', () => {
    assert.equal(classifyRole({ tag: 'nav', text: '', headings: [], bounds: { y: 9000, h: 60 }, position: 'fixed' }, null, null).role, 'nav');
    assert.equal(classifyRole({ tag: 'header', text: '', headings: [], bounds: { y: 0, h: 107 }, position: 'static' }, null, null).role, 'nav');
    assert.equal(classifyRole({ tag: 'div', role: 'navigation', text: '', headings: [], bounds: { y: 150, h: 60 }, position: 'static' }, null, null).role, 'nav');
  });

  it('a class name alone no longer makes a nav', () => {
    assert.notEqual(classifyRole({ tag: 'div', className: 'nav-wrapper', text: 'Home', headings: [], bounds: { y: 0, h: 60 } }, null, null).role, 'nav');
  });

  it('the hero candidate beats text rules such as comparison', () => {
    const r = classifyRole({ tag: 'div', heroCandidate: true, text: 'Odyssey vs the rest', headings: ['Odyssey'], cardCount: 2, bounds: { y: 107, h: 820 } }, null, 'landing');
    assert.equal(r.role, 'hero');
  });

  it('records without bounds keep the old landmark behaviour', () => {
    assert.equal(classifyRole({ tag: 'nav', text: '', headings: [] }, null, null).role, 'nav');
  });
});

describe('hero candidate skips nav landmarks and overlays (Opus One records)', () => {
  const opusOne = [
    band({ tag: 'header', className: 'header header--loaded', position: 'fixed', bounds: { x: 0, y: 0, w: 1280, h: 120 }, media: { kind: 'photo', share: 0.62, src: 'https://www.opusonewinery.com/logo.png' }, heading: { level: 2, fontSize: 26, text: 'Opus One' }, text: 'Menu Visit Shop' }),
    band({ tag: 'section', className: 'page-banner lazyloaded', position: 'relative', bounds: { x: 0, y: 0, w: 1280, h: 688 }, background: { color: null, imageUrl: 'https://www.opusonewinery.com/banner.jpg', hasVideo: false }, media: { kind: 'photo', share: 1, src: 'https://www.opusonewinery.com/banner.jpg' }, text: '' }),
    band({ tag: 'div', className: 'go2933276541 go2369186930', position: 'fixed', bounds: { x: 0, y: 0, w: 1280, h: 800 }, background: { color: '#000000', imageUrl: null, hasVideo: false }, text: '' }),
    band({ tag: 'div', className: 'banner-content', position: 'relative', bounds: { x: 0, y: 688, w: 1280, h: 135 }, heading: { level: 1, fontSize: 50, text: 'Opus One' }, text: 'Opus One' }),
  ];
  const bp = extractBlueprint(opusOne, [], { type: 'landing' }, { pageHeight: 4015, viewportHeight: 800 });
  it('keeps the header as nav and makes the full-bleed banner the hero', () => {
    assert.equal(bp.readingOrder[0], 'nav');
    assert.equal(bp.bands.find(b => b.className.startsWith('page-banner')).role, 'hero');
    assert.ok(bp.heroIndex >= 0 && bp.heroIndex <= 2, `heroIndex ${bp.heroIndex}`);
  });
  it('never gives the hero slot to a fixed empty overlay', () => {
    assert.notEqual(bp.bands.find(b => b.className.startsWith('go2933276541')).role, 'hero');
  });
});

describe('stripBandText: raw band text must not survive into rawData', () => {
  it('deletes text in place, leaving every other field untouched', () => {
    const bands = odyssey.map((b) => ({ ...b }));
    const stripped = stripBandText(bands);
    assert.equal(stripped, bands, 'must return the same array, mutated in place');
    for (const b of stripped) assert.ok(!('text' in b), JSON.stringify(b));
    assert.equal(bands[0].tag, 'header');
    assert.equal(bands[0].textLength, 22, 'textLength is a count, not raw copy, and must survive');
  });

  it('tolerates a missing or empty bands array', () => {
    assert.deepEqual(stripBandText([]), []);
    assert.deepEqual(stripBandText(undefined), undefined);
  });
});

describe('repeated cards with buttons beat the testimonial class hint', () => {
  const bands = [
    band({ tag: 'header', position: 'fixed', bounds: { x: 0, y: 0, w: 1280, h: 80 }, text: '' }),
    band({ tag: 'div', className: 'fusion-fullwidth reviews-grid', bounds: { x: 0, y: 880, w: 1280, h: 3188 },
      heading: { level: 2, fontSize: 36, text: 'Home Remodeling Services' }, buttonCount: 10, cardCount: 1,
      repeats: { count: 10, w: 624, h: 616, perRow: 2, withImage: 10, withButton: 10 }, text: 'Additions Sunrooms Decks' }),
    band({ tag: 'div', className: 'fusion-fullwidth quotes', bounds: { x: 0, y: 4068, w: 1280, h: 900 },
      heading: { level: 2, fontSize: 36, text: 'What homeowners say' }, buttonCount: 0, cardCount: 0,
      repeats: { count: 4, w: 600, h: 300, perRow: 2, withImage: 0, withButton: 0 }, text: '"They were on time and on budget" — Jane Doe' }),
  ];
  const bp = extractBlueprint(bands, [], { type: 'landing' }, { pageHeight: 6000, viewportHeight: 800 });
  it('classifies the card grid as feature-grid and carries repeats', () => {
    const grid = bp.bands.find((b) => b.className.includes('reviews-grid'));
    assert.equal(grid.role, 'feature-grid');
    assert.deepEqual(grid.repeats, bands[1].repeats);
  });
  it('leaves a quote grid without buttons as testimonial', () => {
    assert.equal(bp.bands.find((b) => b.className.includes('quotes')).role, 'testimonial');
  });
  it('records without repeats carry null', () => {
    assert.equal(bp.bands[0].repeats, null);
  });
});
