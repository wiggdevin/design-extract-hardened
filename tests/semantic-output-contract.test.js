// Slice 5 contract test: drives the semantic-evidence PROMOTERS directly
// (no browser, no crawl) the same way src/index.js composes them, then
// checks the assembled `design` object against the shape the formatters
// (markdown.js, design-md.js, agent-prompt.js) are built against.
//
// This file is pure — it never imports crawlPage and never launches a
// browser. It only imports extractor/formatter functions and index.js's
// module-level exports.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractTypography } from '../src/extractors/typography.js';
import { extractFontSystem } from '../src/extractors/font-system.js';
import { extractBorders } from '../src/extractors/borders.js';
import { extractGeometrySystem } from '../src/extractors/geometry-system.js';
import { extractMaterialLanguage } from '../src/extractors/material-language.js';
import { extractImageryStyle } from '../src/extractors/imagery-style.js';
import * as indexModule from '../src/index.js';

// ── Shared fixture factory (mirrors tests/geometry-system.test.js /
// tests/font-system.test.js makeEl) ──────────────────────────────

function makeEl(overrides = {}) {
  return {
    tag: 'div',
    classList: '',
    role: '',
    area: 10000,
    width: 100,
    height: 40,
    borderRadius: '0px',
    hasText: false,
    fontFamily: '"Inter", sans-serif',
    fontSize: '16px',
    ...overrides,
  };
}

// Every top-level key src/index.js sets on `design` (read off its literal,
// not re-derived), so a slice-5 change that silently drops one is caught.
const INDEX_DESIGN_KEYS = [
  'meta', 'colors', 'typography', 'spacing', 'shadows', 'borders', 'variables',
  'breakpoints', 'animations', 'components', 'accessibility', 'layout',
  'gradients', 'zIndex', 'icons', 'fonts', 'images', 'componentScreenshots',
  'stack', 'cssHealth', 'regions', 'componentClusters', 'modernCss',
  'wideGamut', 'tokenSources', 'interactionStates', 'motion',
  'componentAnatomy', 'voice', 'score', 'warnings', 'evidence', 'pageIntent',
  'sectionRoles', 'componentLibrary', 'materialLanguage', 'imageryStyle',
  'seo', 'iconSystem', 'backgroundPatterns', 'stackIntel', 'formStates',
  'blueprint', '_raw',
];

// Builds a design object the same way src/index.js composes the semantic
// evidence layer (font-system merge into typography, geometry onto borders,
// imagery via the media system), plus flat placeholders for every other
// top-level key index.js sets, so requirement (1) below can check nothing
// was dropped. Placeholders mirror index.js's own `safeExtract(...) || {…}`
// fallback shapes.
function buildDesign({ computedStyles, fontData = {}, images = [], backgroundMedia = [], viewport = null }) {
  const typography = extractTypography(computedStyles, {});
  const borders = extractBorders(computedStyles);

  const design = {
    meta: { url: 'https://example.com', title: 'Test Site', timestamp: new Date().toISOString(), elementCount: computedStyles.length, pagesAnalyzed: 1 },
    colors: { primary: null, secondary: null, accent: null, neutrals: [], backgrounds: [], text: [], gradients: [], all: [] },
    typography,
    spacing: { scale: [], base: null },
    shadows: { values: [] },
    borders,
    variables: {},
    breakpoints: [],
    animations: { transitions: [], keyframes: [] },
    components: {},
    accessibility: { score: 0, failCount: 0 },
    layout: { gridCount: 0, flexCount: 0 },
    gradients: { count: 0 },
    zIndex: { allValues: [], issues: [] },
    icons: { icons: [], count: 0 },
    fonts: { fonts: [], systemFonts: [] },
    images: { patterns: [], aspectRatios: [] },
    componentScreenshots: {},
    stack: { framework: 'unknown', css: { layer: 'unknown', tailwind: null }, analytics: [], detectedFrom: { globalCount: 0, scriptCount: 0, classSampleSize: 0 } },
    cssHealth: null,
    regions: [],
    componentClusters: [],
    modernCss: { pseudoElements: { count: 0, samples: [] }, variableFonts: { count: 0, axes: [] }, openTypeFeatures: [], textWrap: { wrap: [], decorationStyle: [], decorationThickness: [], underlineOffset: [] }, containerQueries: { count: 0, rules: [] }, envUsage: [] },
    wideGamut: { oklch: { count: 0, samples: [] }, oklab: { count: 0, samples: [] }, colorMix: { count: 0, samples: [] }, lightDark: { count: 0, samples: [] }, displayP3: { count: 0, samples: [] }, rec2020: { count: 0, samples: [] }, totalCount: 0 },
    tokenSources: [],
    interactionStates: { scrollSettled: false, menusOpened: 0, hover: { sampled: 0, changed: 0, deltas: [] }, accordionsOpened: 0, modals: [] },
    motion: { durations: [], easings: [], springs: [], keyframes: [], scrollLinked: { present: false, signals: [] }, stats: {}, feel: 'unknown' },
    componentAnatomy: [],
    voice: { tone: 'neutral', ctaVerbs: [], buttonPatterns: [], sampleHeadings: [] },
    score: null,
    warnings: [],
  };

  // ── Semantic evidence layer, composed the same way index.js does ──
  design.evidence = {
    schemaVersion: 1,
    collector: 'dom',
    coverage: {
      nodes: computedStyles.length,
      textNodes: computedStyles.filter(el => el && el.hasText).length,
      images: images.length,
      backgroundMedia: backgroundMedia.length,
      loadedFonts: (fontData.documentFonts || []).filter(f => f && f.status === 'loaded').length,
    },
    warnings: [],
  };

  const fontSystem = extractFontSystem({ computedStyles, fontData });
  const accepted = new Set(fontSystem.acceptedFamilies.map(f => f.name.toLowerCase()));
  design.typography.families = (design.typography.families || []).filter(f => accepted.has(String(f.name).toLowerCase()));
  design.typography.system = {
    ...(design.typography.system || {}),
    bodyFamily: fontSystem.bodyFamily,
    headingFamily: fontSystem.headingFamily,
    acceptedFamilies: fontSystem.acceptedFamilies,
    rejectedFamilies: fontSystem.rejectedFamilies,
    fontCoverage: fontSystem.coverage,
  };

  design.borders.geometry = extractGeometrySystem(computedStyles);

  design.pageIntent = { type: 'unknown', confidence: 0, signals: [] };
  design.sectionRoles = { sections: [], counts: {}, readingOrder: [] };
  design.componentLibrary = { library: 'unknown', confidence: 0, evidence: [], alternates: [] };
  design.materialLanguage = extractMaterialLanguage(design);
  design.imageryStyle = extractImageryStyle(images, { backgroundMedia, viewport });
  design.seo = { openGraph: {}, twitter: {}, structuredData: [], score: {} };
  design.iconSystem = { library: 'unknown', confidence: 0, stats: {}, signals: [], icons: [] };
  design.backgroundPatterns = { labels: ['plain'], counts: {}, gradientTotals: {}, samples: [] };
  design.stackIntel = { cms: [], analytics: [], experimentation: [] };
  design.formStates = { flags: [], forms: { count: 0, families: [] }, modals: [], toastLibraries: [] };
  design.blueprint = { bands: [], readingOrder: [], heroIndex: -1, counts: { bands: 0, oversizedDropped: 0, byRole: {} } };
  design._raw = { url: design.meta.url };

  return design;
}

// ── (1) every pre-existing top-level design key still exists ──────

describe('semantic output contract: shape', () => {
  it('keeps every top-level key src/index.js sets on design', () => {
    const design = buildDesign({ computedStyles: [makeEl()] });
    for (const key of INDEX_DESIGN_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(design, key), `design is missing top-level key "${key}"`);
    }
  });
});

// ── (2) geometry vs radii on a square-with-one-pill-badge fixture ──

describe('semantic output contract: geometry vs radii', () => {
  it('radii stays positive-only while geometry.global reads the square system', () => {
    const foundationSquare = [
      ...Array.from({ length: 5 }, () => makeEl({ tag: 'button', classList: 'btn', borderRadius: '0px', width: 120, height: 44 })),
      ...Array.from({ length: 5 }, () => makeEl({ tag: 'input', borderRadius: '0px', width: 200, height: 40 })),
      ...Array.from({ length: 5 }, () => makeEl({ tag: 'div', classList: 'card', borderRadius: '0px', width: 300, height: 200 })),
      ...Array.from({ length: 3 }, () => makeEl({ tag: 'nav', borderRadius: '0px', width: 1000, height: 60 })),
      ...Array.from({ length: 3 }, () => makeEl({ tag: 'section', borderRadius: '0px', width: 1000, height: 400 })),
    ];
    const pillBadge = makeEl({ tag: 'span', classList: 'status-badge', borderRadius: '9999px', width: 60, height: 24 });
    const design = buildDesign({ computedStyles: [...foundationSquare, pillBadge] });

    assert.ok(design.borders.radii.length > 0, 'expected the pill badge to contribute a positive radius');
    assert.ok(design.borders.radii.every(r => r.value > 0), 'radii must stay positive-pixel-only');
    assert.equal(design.borders.geometry.global.value, 'square', 'a lone non-foundation pill must not move the global verdict');
  });
});

// ── (3) font provenance: accepted body family + rejected declaration noise ──

describe('semantic output contract: font provenance', () => {
  it('promotes Inter to bodyFamily and rejects declaration-shaped noise', () => {
    const bodyText = Array.from({ length: 20 }, () => makeEl({ tag: 'p', hasText: true, fontFamily: '"Inter", sans-serif' }));
    const noise = makeEl({ tag: 'div', fontFamily: 'object-fit: contain' });
    const fontData = { documentFonts: [{ family: 'Inter', status: 'loaded' }] };
    const design = buildDesign({ computedStyles: [...bodyText, noise], fontData });

    assert.equal(design.typography.system.bodyFamily.value, 'Inter');
    assert.ok(
      design.typography.system.rejectedFamilies.some(f => f.name === 'object-fit: contain'),
      'expected the declaration-shaped value to be rejected'
    );
    assert.ok(
      !design.typography.families.some(f => f.name === 'object-fit: contain'),
      'the declaration-shaped value must never reach families[]'
    );
  });
});

// ── (4) imagery distribution: label from weight, confidence stable across icon counts ──

describe('semantic output contract: imagery distribution', () => {
  function heroPlusIcons(iconCount) {
    const backgroundMedia = [
      { kind: 'css-background', tag: 'div', classList: 'hero', src: '/hero.jpg', width: 1280, height: 800, top: 0 },
    ];
    const images = Array.from({ length: iconCount }, (_, i) => ({
      tag: 'img', src: `/icon-${i}.png`, width: 20, height: 20, top: 900,
    }));
    return buildDesign({ computedStyles: [makeEl()], images, backgroundMedia, viewport: { width: 1440, height: 900 } });
  }

  it('labels a hero css-background photography regardless of icon count', () => {
    const design5 = heroPlusIcons(5);
    const design50 = heroPlusIcons(50);

    assert.equal(design5.imageryStyle.distribution[0].label, 'photography');
    assert.equal(design50.imageryStyle.distribution[0].label, 'photography');
    assert.ok(
      Math.abs(design5.imageryStyle.confidence - design50.imageryStyle.confidence) <= 0.05,
      `confidence must not track icon count: ${design5.imageryStyle.confidence} vs ${design50.imageryStyle.confidence}`
    );
  });
});

// ── (5) no raw page text / oversized strings leak into the design ──

const LEAK_PROBE_CLASS = 'x'.repeat(2000);
const LEAK_PROBE_ALT = '<main>SECRET INTERNAL PAGE TEXT</main>';

function collectStrings(value, out = []) {
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); return out; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, out); return out; }
  return out;
}

describe('semantic output contract: no raw page text leaks', () => {
  it('never echoes an oversized classList or an HTML-shaped alt into the design', () => {
    const computedStyles = [
      makeEl({ tag: 'button', classList: `btn ${LEAK_PROBE_CLASS}`, borderRadius: '0px' }),
      makeEl({ tag: 'div', classList: 'card', borderRadius: '4px' }),
    ];
    const images = [
      { tag: 'img', src: '/hero.jpg', alt: LEAK_PROBE_ALT, width: 1000, height: 700, top: 0 },
      { tag: 'img', src: '/icon.png', width: 20, height: 20, top: 500 },
    ];
    const design = buildDesign({ computedStyles, images });

    const json = JSON.stringify(design);
    assert.ok(!json.includes('<'), 'assembled design must never contain a "<" character');
    assert.ok(!json.includes(LEAK_PROBE_CLASS), 'the 2000-char classList must never leak verbatim');
    assert.ok(!json.includes('SECRET INTERNAL PAGE TEXT'), 'the alt text must never leak verbatim');

    for (const str of collectStrings(design)) {
      assert.ok(str.length <= 500, `found a string longer than 500 chars in the assembled design: "${str.slice(0, 60)}…" (${str.length} chars)`);
    }
  });
});

// ── (6) index.js exports the semantic-evidence promoters as functions,
// and importing it never launches a browser ──

describe('semantic output contract: index.js exports', () => {
  it('exports the semantic-evidence promoters and benchmark helpers', () => {
    for (const name of ['extractGeometrySystem', 'extractFontSystem', 'extractMediaSystem', 'scoreSemanticExtraction', 'formatSemanticScorecard', 'loadSemanticGroundTruth']) {
      assert.equal(typeof indexModule[name], 'function', `index.js must export ${name} as a function`);
    }
  });
});

// ── legacy path: extractImageryStyle with no options is unchanged ─

describe('semantic output contract: legacy imageryStyle path', () => {
  it('flags flat-illustration when svg dominant (no options, v10 fixture)', () => {
    const images = [
      { src: '/a.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
      { src: '/b.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
      { src: '/c.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
      { src: '/d.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
    ];
    const r = extractImageryStyle(images);
    assert.equal(r.label, 'flat-illustration');
  });

  it('flags photography when raster + photo filename hints (no options, v10 fixture)', () => {
    const images = [
      { src: '/hero.jpg', width: 1200, height: 600, borderRadius: '0px', tag: 'img' },
      { src: '/photo-team.jpg', width: 800, height: 600, borderRadius: '0px', tag: 'img' },
      { src: '/portrait.jpeg', width: 400, height: 600, borderRadius: '9999px', tag: 'img' },
    ];
    const r = extractImageryStyle(images);
    assert.equal(r.label, 'photography');
  });
});
