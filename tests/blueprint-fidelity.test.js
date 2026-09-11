import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreBlueprintFidelity } from '../src/fidelity/blueprint-fidelity.js';

const b = (over) => ({ role: 'content', background: { color: '#ffffff', imageUrl: null, hasVideo: false }, columns: 1, media: { kind: 'none' }, bounds: { h: 600 }, ...over });
const original = { bands: [
  b({ role: 'nav', bounds: { h: 107 }, background: { color: '#0f2a44', imageUrl: null, hasVideo: false } }),
  b({ role: 'hero', media: { kind: 'photo' }, bounds: { h: 820 } }),
  b({ role: 'feature-grid', columns: 2, media: { kind: 'photo' }, bounds: { h: 900 } }),
] };

describe('scoreBlueprintFidelity', () => {
  it('scores identical blueprints 100 with every check matched', () => {
    const r = scoreBlueprintFidelity(original, structuredClone(original));
    assert.equal(r.score, 100);
    assert.equal(r.matched, 15);
    assert.equal(r.total, 15);
    assert.equal(r.unmatchedBands, 0);
    assert.deepEqual(r.bands[0].checks, { role: true, background: true, columns: true, media: true, height: true });
  });

  it('charges one full band for a missing band', () => {
    const clone = { bands: original.bands.slice(0, 2) };
    const r = scoreBlueprintFidelity(original, clone);
    assert.equal(r.aligned, 2);
    assert.equal(r.unmatchedBands, 1);
    assert.equal(r.total, 15);
    assert.equal(r.matched, 10);
    assert.equal(r.score, 67);
  });

  it('charges one check for a column mismatch and reports which band', () => {
    const clone = structuredClone(original);
    clone.bands[2].columns = 3;
    const r = scoreBlueprintFidelity(original, clone);
    assert.equal(r.score, 93);
    assert.equal(r.bands[2].checks.columns, false);
    assert.equal(r.bands[2].matched, 4);
  });

  it('accepts a background colour within OKLab 0.08 and rejects a far one', () => {
    const near = structuredClone(original); near.bands[0].background.color = '#102b45';
    const far = structuredClone(original); far.bands[0].background.color = '#ffffff';
    assert.equal(scoreBlueprintFidelity(original, near).bands[0].checks.background, true);
    assert.equal(scoreBlueprintFidelity(original, far).bands[0].checks.background, false);
  });

  it('matches backgrounds by kind when either side is an image or a video', () => {
    const a = { bands: [b({ background: { color: null, imageUrl: 'https://a.example/x.jpg', hasVideo: false } })] };
    const img = { bands: [b({ background: { color: null, imageUrl: 'https://b.example/y.jpg', hasVideo: false } })] };
    const flat = { bands: [b()] };
    const vid = { bands: [b({ background: { color: null, imageUrl: null, hasVideo: true } })] };
    assert.equal(scoreBlueprintFidelity(a, img).bands[0].checks.background, true);
    assert.equal(scoreBlueprintFidelity(a, flat).bands[0].checks.background, false);
    assert.equal(scoreBlueprintFidelity(vid, structuredClone(vid)).bands[0].checks.background, true);
    assert.equal(scoreBlueprintFidelity(vid, a).bands[0].checks.background, false);
  });

  it('height matches within 15 percent of the taller band', () => {
    const tall = { bands: [b({ bounds: { h: 1000 } })] };
    assert.equal(scoreBlueprintFidelity(tall, { bands: [b({ bounds: { h: 860 } })] }).bands[0].checks.height, true);
    assert.equal(scoreBlueprintFidelity(tall, { bands: [b({ bounds: { h: 840 } })] }).bands[0].checks.height, false);
  });

  it('returns a null score when neither side has bands', () => {
    assert.equal(scoreBlueprintFidelity({ bands: [] }, { bands: [] }).score, null);
    assert.equal(scoreBlueprintFidelity(undefined, undefined).score, null);
    assert.equal(scoreBlueprintFidelity(original, { bands: [] }).score, 0);
  });

  it('never throws on null background, media, bounds, or a null band entry', () => {
    const sparse = { bands: [
      { role: 'content', background: null, columns: 1, media: null, bounds: null },
      null,
    ] };
    const r = scoreBlueprintFidelity(sparse, structuredClone(sparse));
    assert.equal(r.aligned, 2);
    assert.equal(r.bands[0].checks.background, true, 'two empty backgrounds match');
    assert.equal(r.bands[0].checks.media, true, 'two missing media kinds both read as none');
    assert.equal(r.bands[0].checks.height, true, 'two zero heights match');
    assert.equal(typeof r.bands[1].matched, 'number');
    assert.equal(r.score, Math.round((100 * r.matched) / r.total));
  });
});
