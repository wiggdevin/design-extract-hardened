import { describe, it } from 'node:test';
import assert from 'node:assert';

import { extractMediaSystem } from '../src/extractors/media-system.js';
import { extractImageryStyle } from '../src/extractors/imagery-style.js';

describe('extractMediaSystem: weight-driven dominance', () => {
  it('one big hero photograph beats 40 icons', () => {
    const images = [
      { tag: 'img', src: '/hero.jpg', width: 1000, height: 700, top: 0 },
      ...Array.from({ length: 40 }, (_, i) => ({
        tag: 'img', src: `/icon-${i}.png`, width: 20, height: 20, top: 100,
      })),
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'photography');
    assert.ok(r.distribution[0].share > 0.9, `expected share > 0.9, got ${r.distribution[0].share}`);
  });

  it('a hidden hero (opacity 0) does not vote', () => {
    const images = [
      { tag: 'img', src: '/hero.jpg', width: 1000, height: 700, top: 0, opacity: 0 },
      { tag: 'img', src: '/mark.svg', width: 200, height: 200, top: 100 },
      ...Array.from({ length: 5 }, (_, i) => ({
        tag: 'img', src: `/icon-${i}.png`, width: 16, height: 16, top: 300,
      })),
    ];
    const r = extractMediaSystem({ images });
    assert.notEqual(r.label, 'photography');
    assert.ok(r.dominantMedia.every(m => m.src !== '/hero.jpg'), 'hidden hero must not appear in dominantMedia');
  });

  it('a large css-background jpeg outweighs tiny <img> icons', () => {
    const backgroundMedia = [
      { kind: 'css-background', tag: 'div', classList: 'hero', src: '/bg.jpg', width: 1280, height: 800, top: 0 },
    ];
    const images = Array.from({ length: 10 }, (_, i) => ({
      tag: 'img', src: `/icon-${i}.png`, width: 24, height: 24, top: 900,
    }));
    const r = extractMediaSystem({ images, backgroundMedia });
    assert.equal(r.label, 'photography');
  });

  it('an all-icon page reports iconography', () => {
    const images = Array.from({ length: 12 }, (_, i) => ({
      tag: 'img', src: `/icon-${i}.png`, width: 20, height: 20, top: 0,
    }));
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'iconography');
  });

  it('svg-dominant page is illustration', () => {
    const images = [
      { tag: 'svg', src: '/a.svg', width: 200, height: 200, top: 0 },
      { tag: 'svg', src: '/b.svg', width: 200, height: 200, top: 300 },
      { tag: 'svg', src: '/c.svg', width: 200, height: 200, top: 600 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'illustration');
  });

  it('recovers the original extension from an image-proxy url= parameter', () => {
    // n26.com and mercury.com serve photos through /_next/image; the jpg is in the query.
    const images = [
      { tag: 'img', src: '/_next/image?url=%2Fstatic%2Fhero.jpg&w=1200&q=75', width: 800, height: 600, top: 0, naturalWidth: 1600, naturalHeight: 1200 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'photography');
    assert.ok(!r.signals.includes('extensionless-source'), 'a recovered extension is not extensionless');
  });

  it('a truly extensionless large raster is unknown with a signal, never a confident photograph', () => {
    // linear.app (screenshots) and a photo CDN look identical from the DOM.
    const images = [
      { tag: 'img', src: 'https://cdn.example.com/images/abc123?w=1200', width: 800, height: 600, top: 0, naturalWidth: 1600, naturalHeight: 1200 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'unknown');
    assert.ok(r.signals.includes('extensionless-source'), `expected signal, got ${JSON.stringify(r.signals)}`);
    assert.ok(!r.distribution.some(d => d.label === 'photography'));
  });

  it('a large png without hints is unknown with a png-ambiguous signal', () => {
    // liveaevi.com's hero png is a photograph; linear.app's are screenshots.
    const images = [{ tag: 'img', src: '/hero.png', width: 1200, height: 700, top: 0 }];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'unknown');
    assert.ok(r.signals.includes('png-ambiguous'));
  });

  it('non-svg data: URIs are blur-up placeholders and do not vote', () => {
    // mercury.com carries 19 data:image/webp backgrounds the size of the hero.
    const images = [{ tag: 'img', src: '/hero.jpg', width: 600, height: 400, top: 0 }];
    const backgroundMedia = Array.from({ length: 5 }, () => ({ kind: 'css-background', src: 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', width: 1280, height: 800, top: 0 }));
    const r = extractMediaSystem({ images, backgroundMedia });
    assert.equal(r.label, 'photography');
    assert.ok(r.signals.some(s => /5 data-uri placeholders excluded/.test(s)), JSON.stringify(r.signals));
  });

  it('a canvas hero is unknown with a canvas-rendered signal', () => {
    // spline.design paints its 3D hero on WebGL canvases with no raster media.
    const backgroundMedia = [{ kind: 'canvas', src: '', width: 1280, height: 700, top: 0 }];
    const images = [{ tag: 'img', src: '/logo.png', width: 32, height: 32, top: 0 }];
    const r = extractMediaSystem({ images, backgroundMedia });
    assert.equal(r.label, 'unknown');
    assert.ok(r.signals.includes('canvas-rendered'));
    assert.ok(!r.distribution.some(d => d.label === 'photography'));
  });

  it('classifies a video poster by its source, not as photography by default', () => {
    // hyperliquid.xyz posters a rendered png.
    const png = extractMediaSystem({ backgroundMedia: [{ kind: 'video-poster', src: '/assets/frame.png', width: 1280, height: 720, top: 0 }] });
    assert.equal(png.label, 'unknown');
    assert.ok(png.signals.includes('poster-ambiguous'));
    const jpg = extractMediaSystem({ backgroundMedia: [{ kind: 'video-poster', src: 'https://cdn.example.com/frame_86400.jpg', width: 1280, height: 720, top: 0 }] });
    assert.equal(jpg.label, 'photography');
  });

  it('ignores url(#fragment) paint-server references captured as backgrounds', () => {
    // mercury.com's largest "background" was url(#n), an SVG filter reference.
    const images = [{ tag: 'img', src: '/_next/image?url=%2Fhero.jpg&w=1920', width: 1280, height: 800, top: 0 }];
    const backgroundMedia = [{ kind: 'css-background', src: '%23n', width: 1280, height: 1333, top: 0 }];
    const r = extractMediaSystem({ images, backgroundMedia });
    assert.equal(r.label, 'photography');
    assert.ok(!r.dominantMedia.some(m => m.src === '%23n'));
  });

  it('photography and product-photography are one family for the label margin', () => {
    // fillingpieces.com: 52% product shots, 45% scene photography is photography-led, not mixed.
    const images = [
      { tag: 'img', src: '/product-1.jpg', classList: 'product-card', width: 700, height: 700, top: 0 },
      { tag: 'img', src: '/scene.jpg', width: 650, height: 650, top: 0 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'product-photography');
    assert.deepEqual(r.distribution.slice(0, 2).map(d => d.label), ['product-photography', 'photography']);
  });

  it('a png with a dashboard class hint is ui-screenshot even when square', () => {
    const images = [
      { tag: 'img', src: '/app.png', classList: 'app-dashboard-screenshot', width: 500, height: 500, top: 0 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'ui-screenshot');
  });

  it('no candidates yields none', () => {
    const r = extractMediaSystem({});
    assert.equal(r.label, 'none');
    assert.deepEqual(r.distribution, []);
  });

  it('a near-tie between two labels is mixed', () => {
    const images = [
      { tag: 'img', src: '/photo.jpg', width: 400, height: 400, top: 0 },
      { tag: 'svg', src: '/illustration.svg', width: 400, height: 400, top: 500 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'mixed');
  });

  it('a malformed backgroundMedia entry (null) is skipped, not thrown', () => {
    const images = [{ tag: 'img', src: '/a.jpg', width: 100, height: 100, top: 0 }];
    assert.doesNotThrow(() => extractMediaSystem({ images, backgroundMedia: [null] }));
    const r = extractMediaSystem({ images, backgroundMedia: [null] });
    assert.equal(r.label, 'photography', 'the one good image candidate must still classify');
  });

  it('a malformed images entry (non-object) is skipped, not thrown', () => {
    const r = extractMediaSystem({ images: [null, { tag: 'img', src: '/a.jpg', width: 100, height: 100, top: 0 }] });
    assert.equal(r.label, 'photography');
  });

  it('an explicit null for images/backgroundMedia degrades to no candidates instead of throwing', () => {
    assert.doesNotThrow(() => extractMediaSystem({ images: null, backgroundMedia: null }));
    const r = extractMediaSystem({ images: null, backgroundMedia: null });
    assert.equal(r.label, 'none');
  });

  it('negative dimensions on one candidate do not fabricate a positive photography weight', () => {
    // Two negative dimensions multiply to a large positive number; both are
    // individually < ICON_MAX_SIDE, so without clamping this candidate is
    // flagged as an icon (forcing iconography) while still reporting itself
    // as a huge photography weight in distribution/dominantMedia/confidence.
    const images = [
      { tag: 'img', src: '/icon-a.png', width: 20, height: 20, top: 0 },
      { tag: 'img', src: '/glitch.jpg', width: -2000, height: -2000, top: 0 },
    ];
    const r = extractMediaSystem({ images });
    assert.equal(r.label, 'iconography');
    for (const d of r.distribution) {
      assert.ok(d.weight <= 0 || d.label !== 'photography', `distribution must not show a fabricated photography weight, got ${JSON.stringify(d)}`);
    }
    assert.ok(r.dominantMedia.every(m => m.src !== '/glitch.jpg'), 'a negative-dimension candidate must not appear as a weighted dominant media entry');
    // The only voter is the icon, so the distribution must agree with the label.
    assert.deepEqual(r.distribution.map(d => d.label), ['iconography']);
  });

  it('an overflowing width/height does not poison the payload with NaN/null', () => {
    const images = [{ tag: 'img', src: '/huge.jpg', width: 1e200, height: 1e200, top: 0 }];
    const r = extractMediaSystem({ images });
    assert.ok(Number.isFinite(r.confidence), `confidence must be finite, got ${r.confidence}`);
    assert.ok(Number.isFinite(r.coverage), `coverage must be finite, got ${r.coverage}`);
    for (const d of r.distribution) {
      assert.ok(Number.isFinite(d.share), `distribution share must be finite, got ${d.share}`);
      assert.ok(Number.isFinite(d.weight), `distribution weight must be finite, got ${d.weight}`);
    }
    for (const m of r.dominantMedia) {
      assert.ok(Number.isFinite(m.weight), `dominantMedia weight must be finite, got ${m.weight}`);
    }
  });

  it('a below-fold hero weighs less than the same hero in-viewport', () => {
    const viewport = { height: 800 };
    const inView = extractMediaSystem({
      images: [{ tag: 'img', src: '/hero.jpg', width: 500, height: 300, top: 0 }],
      viewport,
    });
    const belowFold = extractMediaSystem({
      images: [{ tag: 'img', src: '/hero.jpg', width: 500, height: 300, top: 750 }],
      viewport,
    });
    assert.ok(
      belowFold.dominantMedia[0].weight < inView.dominantMedia[0].weight,
      `expected below-fold weight < in-viewport weight, got ${belowFold.dominantMedia[0].weight} vs ${inView.dominantMedia[0].weight}`,
    );
  });
});

describe('extractImageryStyle: legacy contract preserved', () => {
  it('unchanged for the v10 svg-dominant fixture with no options arg', () => {
    const images = [
      { src: '/a.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
      { src: '/b.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
      { src: '/c.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
      { src: '/d.svg', width: 200, height: 200, borderRadius: '0px', tag: 'img' },
    ];
    const r = extractImageryStyle(images);
    assert.equal(r.label, 'flat-illustration');
    assert.equal(r.distribution, undefined, 'legacy mode must not add evidence-rich fields');
  });

  it('unchanged for the v10 photography-hint fixture with no options arg', () => {
    const images = [
      { src: '/hero.jpg', width: 1200, height: 600, borderRadius: '0px', tag: 'img' },
      { src: '/photo-team.jpg', width: 800, height: 600, borderRadius: '0px', tag: 'img' },
      { src: '/portrait.jpeg', width: 400, height: 600, borderRadius: '9999px', tag: 'img' },
    ];
    const r = extractImageryStyle(images);
    assert.equal(r.label, 'photography');
  });

  it('switches to evidence-rich mode and gains media-system fields when backgroundMedia is present', () => {
    const images = [
      { src: '/product-1.jpg', width: 600, height: 600, top: 0, naturalWidth: 600, naturalHeight: 600, tag: 'img' },
    ];
    const backgroundMedia = [
      { kind: 'css-background', tag: 'div', classList: 'hero', src: '/bg.jpg', width: 1280, height: 800, top: 0 },
    ];
    const r = extractImageryStyle(images, { backgroundMedia, viewport: { height: 900 } });
    assert.equal(r.label, 'photography');
    assert.ok(Array.isArray(r.distribution));
    assert.ok(Array.isArray(r.dominantMedia));
    assert.equal(typeof r.coverage, 'number');
  });

  it('one malformed backgroundMedia entry does not wipe the already-computed legacy fields', () => {
    const images = [{ tag: 'img', src: '/a.jpg', width: 100, height: 100, top: 0 }];
    const r = extractImageryStyle(images, { backgroundMedia: [null] });
    assert.notEqual(r.label, 'none', 'a real image must not degrade to the safeExtract fallback');
    assert.ok(r.counts && r.counts.total === 1, 'legacy counts must survive');
  });

  it('a malformed images entry (null) is skipped in plain legacy mode, not thrown', () => {
    // safeExtract in index.js wraps this call, but a throw here still
    // discards a page's good legacy fields down to the bare {label:'none'}
    // fallback -- the same failure mode media-system.js was hardened against.
    const images = [null, { tag: 'img', src: '/a.jpg', width: 100, height: 100 }];
    assert.doesNotThrow(() => extractImageryStyle(images));
    const r = extractImageryStyle(images);
    assert.notEqual(r.label, 'none', 'the one good image must still classify');
    assert.equal(r.counts.total, 1, 'the null entry must not be counted');
  });
});

describe('extractMediaSystem: pixel evidence resolves DOM unknowns', () => {
  const viewport = { width: 1280, height: 800 };
  const pngHero = { tag: 'img', src: 'https://shop.example/cdn/files/homepage.png?v=1&width=832', width: 1280, height: 720, top: 0 };
  const evidenceFor = (raw, label, extra = {}) => ({ kind: 'img', src: raw.src, width: raw.width, height: raw.height, top: raw.top, source: 'network', pixel: { label, confidence: 0.8, signals: ['pixel-photo-like'] }, ...extra });

  it('one verdict never spreads to a look-alike candidate (same-size canvases, shared CDN prefix)', () => {
    const canvasA = { kind: 'canvas', src: '', width: 1280, height: 800, top: 0 };
    const canvasB = { kind: 'canvas', src: '', width: 1280, height: 800, top: 900 };
    const evA = { kind: 'canvas', src: '', width: 1280, height: 800, top: 0, source: 'composited', pixel: { label: '3d-render', confidence: 0.6, signals: ['pixel-flat-canvas'] } };
    const r = extractMediaSystem({ backgroundMedia: [canvasA, canvasB], viewport, pixelEvidence: [evA] });
    const withPixel = r.dominantMedia.filter(m => m.pixel);
    assert.equal(withPixel.length, 1, 'only the analysed canvas carries a verdict');
    assert.ok(r.signals.includes('canvas-rendered'));

    const prefix = 'https://cdn.example.com/imagedelivery/fO02fVwohEs9s9UHFwon6A/' + 'a'.repeat(70);
    const imgA = { tag: 'img', src: prefix + '/one.png', width: 1200, height: 700, top: 0 };
    const imgB = { tag: 'img', src: prefix + '/two.png', width: 1200, height: 700, top: 0 };
    const r2 = extractMediaSystem({ images: [imgA, imgB], viewport, pixelEvidence: [evidenceFor(imgA, 'photography')] });
    assert.equal(r2.dominantMedia.filter(m => m.pixel).length, 1);
    assert.equal(r2.dominantMedia.find(m => m.pixel).src, (prefix + '/one.png').slice(0, 120));
  });

  it('a png-ambiguous hero becomes photography when its pixels say so (swimclub.co)', () => {
    const r = extractMediaSystem({ images: [pngHero], viewport, pixelEvidence: [evidenceFor(pngHero, 'photography')] });
    assert.equal(r.label, 'photography');
    assert.ok(r.signals.includes('png-ambiguous'), 'the DOM signal is kept');
    assert.ok(r.signals.includes('pixel-photo-like'));
    assert.ok(r.signals.some(s => /resolved by pixel evidence/.test(s)));
    assert.equal(r.dominantMedia[0].pixel.label, 'photography');
    assert.equal(r.dominantMedia[0].pixel.source, 'network');
    assert.ok(r.coverage > 0.7, `coverage ${r.coverage}`);
  });

  it('an extensionless hero becomes photography (n26.com Bynder transform URL)', () => {
    const hero = { tag: 'img', src: 'https://n26.bynder.com/transform/54968dd6/CRST-18128_PulseSoft', naturalWidth: 2560, naturalHeight: 1600, width: 1280, height: 800, top: 0 };
    const r = extractMediaSystem({ images: [hero], viewport, pixelEvidence: [evidenceFor(hero, 'photography')] });
    assert.equal(r.label, 'photography');
    assert.ok(r.signals.includes('extensionless-source'));
  });

  it('a WebGL canvas becomes 3d-render (spline.design)', () => {
    const canvas = { kind: 'canvas', src: '', width: 1280, height: 800, top: 0 };
    const ev = { kind: 'canvas', src: '', width: 1280, height: 800, top: 0, source: 'composited', pixel: { label: '3d-render', confidence: 0.6, signals: ['pixel-flat-canvas'] } };
    const r = extractMediaSystem({ backgroundMedia: [canvas], viewport, pixelEvidence: [ev] });
    assert.equal(r.label, '3d-render');
    assert.ok(r.signals.includes('canvas-rendered'));
  });

  it('never overrides a DOM label (a product render on white reads flat)', () => {
    const jpg = { tag: 'img', src: 'https://e.com/product-hero.jpg', width: 1200, height: 900, top: 0 };
    const r = extractMediaSystem({ images: [jpg], viewport, pixelEvidence: [evidenceFor(jpg, 'ui-screenshot')] });
    assert.equal(r.label, 'product-photography');
    assert.equal(r.dominantMedia[0].pixel, undefined);
  });

  it('unknown pixel verdicts leave the candidate unknown and carry the reason', () => {
    const r = extractMediaSystem({ images: [pngHero], viewport, pixelEvidence: [{ ...evidenceFor(pngHero, 'unknown'), pixel: { label: 'unknown', confidence: 0, signals: ['pixel-ambiguous'] } }] });
    assert.equal(r.label, 'unknown');
    assert.ok(r.signals.includes('pixel-ambiguous'));
    assert.ok(!r.signals.some(s => /resolved by pixel evidence/.test(s)));
  });

  it('evidence for a different source or size does not attach', () => {
    const r = extractMediaSystem({ images: [pngHero], viewport, pixelEvidence: [evidenceFor({ ...pngHero, src: 'https://shop.example/other.png' }, 'photography')] });
    assert.equal(r.label, 'unknown');
  });

  it('malformed evidence is ignored', () => {
    assert.doesNotThrow(() => extractMediaSystem({ images: [pngHero], viewport, pixelEvidence: [null, 1, {}, { kind: 'img' }] }));
    assert.doesNotThrow(() => extractMediaSystem({ images: [pngHero], viewport, pixelEvidence: 'nope' }));
  });
});
