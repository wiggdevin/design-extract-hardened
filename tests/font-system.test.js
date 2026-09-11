import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFontFamilyList, extractFontSystem } from '../src/extractors/font-system.js';

// ── Shared fixture default (mirrors tests/extractors.test.js makeEl) ────

function makeEl(overrides = {}) {
  return {
    tag: 'div',
    classList: '',
    hasText: false,
    fontFamily: '"Inter", sans-serif',
    fontSize: '16px',
    ...overrides,
  };
}

// Filler elements to push `textElements` well past 100 so a 1-count family
// fails the ">= 1% of hasText elements" visible-text threshold while a
// >=3-count family passes it on the raw-count branch instead.
function filler(count, overrides = {}) {
  return Array.from({ length: count }, () => makeEl({ tag: 'p', hasText: true, fontFamily: '"Helvetica Neue", sans-serif', ...overrides }));
}

// ── parseFontFamilyList ──────────────────────────────────────────

describe('parseFontFamilyList', () => {
  it('splits on top-level commas but not commas inside quotes', () => {
    const parsed = parseFontFamilyList('"ACME, Display", system-ui');
    assert.deepEqual(parsed, [
      { name: 'ACME, Display', generic: false, quoted: true },
      { name: 'system-ui', generic: true, quoted: false },
    ]);
  });

  it('rejects declaration-shaped values (unquoted)', () => {
    assert.deepEqual(parseFontFamilyList('object-fit: contain'), []);
  });

  it('rejects declaration-shaped values (quoted)', () => {
    assert.deepEqual(parseFontFamilyList('"object-fit: contain"'), []);
  });

  it('drops control characters and over-long entries', () => {
    assert.deepEqual(parseFontFamilyList('Inter\x07'), []);
    assert.deepEqual(parseFontFamilyList('A'.repeat(200)), []);
  });

  it('returns [] outright when the whole input is oversized', () => {
    assert.deepEqual(parseFontFamilyList('X'.repeat(5000)), []);
  });

  it('marks OS UI stacks and ui-* as generic', () => {
    const parsed = parseFontFamilyList('-apple-system, BlinkMacSystemFont, ui-rounded');
    assert.ok(parsed.every(f => f.generic));
  });
});

// ── extractFontSystem ────────────────────────────────────────────

describe('extractFontSystem', () => {
  it('produces no accepted family from generic-only stacks', () => {
    const styles = [
      makeEl({ tag: 'p', hasText: true, fontFamily: 'sans-serif' }),
      makeEl({ tag: 'span', hasText: true, fontFamily: 'system-ui' }),
    ];
    const result = extractFontSystem({ computedStyles: styles, fontData: {} });
    assert.equal(result.acceptedFamilies.length, 0);
  });

  it('rejects icon fonts even with text present', () => {
    const styles = [
      ...filler(200),
      makeEl({ tag: 'i', hasText: true, fontFamily: '"Font Awesome 6 Free"' }),
      makeEl({ tag: 'i', hasText: true, fontFamily: '"Font Awesome 6 Free"' }),
      makeEl({ tag: 'i', hasText: true, fontFamily: '"Font Awesome 6 Free"' }),
    ];
    const result = extractFontSystem({ computedStyles: styles, fontData: {} });
    assert.ok(!result.acceptedFamilies.some(f => /Font Awesome/i.test(f.name)));
    assert.ok(result.rejectedFamilies.some(f => /Font Awesome/i.test(f.name) && f.reason === 'icon font'));
  });

  it('rejects the malformed "object-fit: contain" family seen only on non-text <img> elements', () => {
    const styles = [
      makeEl({ tag: 'img', hasText: false, fontFamily: '"object-fit: contain"' }),
      makeEl({ tag: 'img', hasText: false, fontFamily: '"object-fit: contain"' }),
    ];
    const result = extractFontSystem({ computedStyles: styles, fontData: {} });
    assert.ok(!result.acceptedFamilies.some(f => /object-fit/i.test(f.name)));
    const rejected = result.rejectedFamilies.find(f => /object-fit/i.test(f.name));
    assert.ok(rejected, 'expected a rejected entry for the malformed family');
    assert.equal(rejected.reason, 'declaration-shaped value');
  });

  it('rejects "Ghost Brand" (text, but below the visible-text threshold and no other provenance)', () => {
    const styles = [
      ...filler(200), // pushes textElements well past 100
      makeEl({ tag: 'p', hasText: true, fontFamily: '"Ghost Brand", sans-serif' }), // only 1 text hit
    ];
    const result = extractFontSystem({ computedStyles: styles, fontData: {} });
    assert.ok(!result.acceptedFamilies.some(f => f.name === 'Ghost Brand'));
    const rejected = result.rejectedFamilies.find(f => f.name === 'Ghost Brand');
    assert.ok(rejected);
    assert.equal(rejected.reason, 'no rendered, authored, or loaded provenance');
  });

  it('accepts "Inter" via loaded-font + text and picks it as bodyFamily', () => {
    const styles = [
      makeEl({ tag: 'p', hasText: true, fontFamily: '"Inter", sans-serif' }),
      makeEl({ tag: 'p', hasText: true, fontFamily: '"Inter", sans-serif' }),
      makeEl({ tag: 'span', hasText: true, fontFamily: '"Inter", sans-serif' }),
      makeEl({ tag: 'div', hasText: false, fontFamily: '"Inter", sans-serif' }),
    ];
    const fontData = { documentFonts: [{ family: 'Inter', style: 'normal', weight: '400', status: 'loaded' }] };
    const result = extractFontSystem({ computedStyles: styles, fontData });
    const accepted = result.acceptedFamilies.find(f => f.name === 'Inter');
    assert.ok(accepted, 'Inter must be accepted');
    assert.ok(accepted.reasons.includes('loaded-font'));
    assert.ok(result.bodyFamily);
    assert.equal(result.bodyFamily.value, 'Inter');
    assert.ok(result.bodyFamily.reasons.includes('loaded-font'));
  });

  it('rejects "Times" when it only ever appears on elements without hasText', () => {
    const styles = [
      makeEl({ tag: 'html', hasText: false, fontFamily: 'Times' }),
      makeEl({ tag: 'head', hasText: false, fontFamily: 'Times' }),
      makeEl({ tag: 'script', hasText: false, fontFamily: 'Times' }),
      makeEl({ tag: 'link', hasText: false, fontFamily: 'Times' }),
      makeEl({ tag: 'meta', hasText: false, fontFamily: 'Times' }),
    ];
    const result = extractFontSystem({ computedStyles: styles, fontData: {} });
    assert.ok(!result.acceptedFamilies.some(f => f.name === 'Times'));
    assert.ok(result.rejectedFamilies.some(f => f.name === 'Times'));
  });

  it('derives headingFamily from h1 elements and returns null with no headings', () => {
    const withHeading = [
      makeEl({ tag: 'h1', hasText: true, fontFamily: '"Playfair Display", serif' }),
      makeEl({ tag: 'h1', hasText: true, fontFamily: '"Playfair Display", serif' }),
      makeEl({ tag: 'h1', hasText: true, fontFamily: '"Playfair Display", serif' }),
    ];
    const fontData = { fontFaces: [{ family: 'Playfair Display', style: 'normal', weight: '700', src: 'x' }] };
    const result = extractFontSystem({ computedStyles: withHeading, fontData });
    assert.ok(result.headingFamily);
    assert.equal(result.headingFamily.value, 'Playfair Display');

    const noHeadings = [makeEl({ tag: 'p', hasText: true, fontFamily: '"Inter", sans-serif' })];
    const result2 = extractFontSystem({
      computedStyles: noHeadings,
      fontData: { documentFonts: [{ family: 'Inter', status: 'loaded' }] },
    });
    assert.equal(result2.headingFamily, null);
  });

  it('does not fabricate visible-text provenance on a page with zero hasText elements', () => {
    // Single element, no hasText anywhere on the page (textElements === 0).
    // hasVisibleText must not default true from a `count >= 0` comparison.
    const styles = [
      makeEl({ tag: 'img', hasText: false, fontFamily: 'Arial', fontSize: '16px' }),
    ];
    const fontData = { documentFonts: [{ family: 'Arial', status: 'loaded' }] };
    const result = extractFontSystem({ computedStyles: styles, fontData });
    // Loaded provenance without any visible text is observed, never promoted
    // (a loaded face that renders no text at capture is not the system).
    assert.equal(result.acceptedFamilies.find(f => f.name === 'Arial'), undefined);
    const rejected = result.rejectedFamilies.find(f => f.name === 'Arial');
    assert.equal(rejected.reason, 'no visible text');
    assert.equal(rejected.textCount, 0);
  });

  it('reports coverage counts', () => {
    const styles = [
      makeEl({ tag: 'p', hasText: true, fontFamily: '"Inter", sans-serif' }),
      makeEl({ tag: 'p', hasText: false, fontFamily: '"Inter", sans-serif' }),
    ];
    const fontData = { documentFonts: [{ family: 'Inter', status: 'loaded' }] };
    const result = extractFontSystem({ computedStyles: styles, fontData });
    assert.equal(result.coverage.textElements, 1);
    assert.equal(result.coverage.accepted, result.acceptedFamilies.length);
    assert.equal(result.coverage.rejected, result.rejectedFamilies.length);
    assert.ok(result.coverage.withProvenance >= 1);
  });
});

// ── Live-site regressions (2026-09-09 benchmark) ────────────────
//
// Promoted names the human-style labelers rejected: Arial rendering a few
// fallback fields (liveaevi.com, emmalewisham.co.uk), a cookie widget's
// GTStandard-M and Open Sans loaded by the widget itself, 'aurberge-icons'
// rendering ligature glyphs, and 'Secondary Font' loaded but painting no
// text at capture time.

describe('extractFontSystem — live-site regressions', () => {
  function page(brand, extras, textElements = 500) {
    const styles = Array.from({ length: textElements }, (_, i) => makeEl({ tag: i % 20 === 0 ? 'h2' : 'p', hasText: true, fontFamily: `"${brand}", sans-serif` }));
    return styles.concat(extras);
  }

  it('rejects an OS face that only renders a handful of fallback fields', () => {
    const styles = page('Brand Sans', Array.from({ length: 8 }, () => makeEl({ tag: 'input', hasText: true, fontFamily: 'Arial' })));
    const result = extractFontSystem({ computedStyles: styles, fontData: { documentFonts: [{ family: 'Brand Sans', status: 'loaded' }] } });
    assert.equal(result.acceptedFamilies.find(f => f.name === 'Arial'), undefined);
    assert.equal(result.rejectedFamilies.find(f => f.name === 'Arial').reason, 'system face below share threshold');
    assert.ok(result.acceptedFamilies.find(f => f.name === 'Brand Sans'));
  });

  it('accepts an OS face that carries the body text or is declared by the site', () => {
    const arialBody = Array.from({ length: 120 }, () => makeEl({ tag: 'p', hasText: true, fontFamily: 'Arial, sans-serif' }));
    const r1 = extractFontSystem({ computedStyles: arialBody, fontData: {} });
    assert.ok(r1.acceptedFamilies.find(f => f.name === 'Arial'), 'body share promotes the OS face');
    const declared = page('Brand Sans', Array.from({ length: 8 }, () => makeEl({ tag: 'input', hasText: true, fontFamily: 'Helvetica' })));
    const r2 = extractFontSystem({ computedStyles: declared, fontData: { fontFaces: [{ family: 'Helvetica', src: 'url(/h.woff2)' }] } });
    assert.ok(r2.acceptedFamilies.find(f => f.name === 'Helvetica'), 'a site-declared @font-face promotes it');
  });

  it('rejects a widget font with loaded provenance but a tiny text share', () => {
    const styles = page('Brand Sans', Array.from({ length: 4 }, () => makeEl({ tag: 'span', hasText: true, fontFamily: '"GTStandard-M", sans-serif' })));
    const result = extractFontSystem({ computedStyles: styles, fontData: { documentFonts: [{ family: 'GTStandard-M', status: 'loaded' }], fontFaces: [{ family: 'GTStandard-M' }] } });
    assert.equal(result.rejectedFamilies.find(f => f.name === 'GTStandard-M').reason, 'below visible-text share threshold');
  });

  it('promotes a heading face even when it appears on only a few elements', () => {
    const styles = page('Brand Sans', Array.from({ length: 2 }, () => makeEl({ tag: 'h1', hasText: true, fontFamily: '"Heading Font", serif' })));
    const result = extractFontSystem({ computedStyles: styles, fontData: { fontFaces: [{ family: 'Heading Font' }], documentFonts: [{ family: 'Brand Sans', status: 'loaded' }] } });
    assert.ok(result.acceptedFamilies.find(f => f.name === 'Heading Font'));
    // The page helper gives Brand Sans 25 h2 elements, so it stays the
    // heading plurality; the point here is promotion, not the winner.
    assert.ok(result.headingFamily.alternatives.some(a => a.name === 'Heading Font'));
  });

  it('rejects site-specific icon faces by name', () => {
    const styles = page('Brand Sans', Array.from({ length: 30 }, () => makeEl({ tag: 'i', hasText: true, fontFamily: 'aurberge-icons' })));
    const result = extractFontSystem({ computedStyles: styles, fontData: { documentFonts: [{ family: 'aurberge-icons', status: 'loaded' }] } });
    assert.equal(result.rejectedFamilies.find(f => f.name === 'aurberge-icons').reason, 'icon font');
  });

  it('rejects a loaded face that paints no text at capture time', () => {
    const styles = page('Brand Sans', Array.from({ length: 12 }, () => makeEl({ tag: 'div', hasText: false, fontFamily: '"Secondary Font", sans-serif' })));
    const result = extractFontSystem({ computedStyles: styles, fontData: { documentFonts: [{ family: 'Secondary Font', status: 'loaded' }], fontFaces: [{ family: 'Secondary Font' }] } });
    assert.equal(result.rejectedFamilies.find(f => f.name === 'Secondary Font').reason, 'no visible text');
  });
});
