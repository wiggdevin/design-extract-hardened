import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlueprint, sectionRolesFromBlueprint } from '../src/extractors/blueprint.js';

const band = (over) => ({
  tag: 'div', role: '', className: 'fusion-fullwidth', id: '', position: 'static',
  bounds: { x: 0, y: 0, w: 1280, h: 600 },
  background: { color: '#ffffff', imageUrl: null, hasVideo: false },
  columns: 1, media: { kind: 'none', share: 0, src: null }, heading: null,
  text: '', textLength: 0, buttonCount: 0, cardCount: 0, ...over,
});

const bands = [
  band({ tag: 'header', bounds: { x: 0, y: 0, w: 1280, h: 100 }, text: 'Services About Contact', buttonCount: 1 }),
  band({ bounds: { x: 0, y: 100, w: 1280, h: 700 }, media: { kind: 'photo', share: 0.6, src: 'hero.jpg' }, heading: { level: 1, fontSize: 52, text: 'Homes built to last' } }),
  band({ tag: 'footer', bounds: { x: 0, y: 800, w: 1280, h: 300 }, text: 'Copyright' }),
];

describe('sectionRolesFromBlueprint: reading order and sections describe the same thing', () => {
  // Composed the way src/index.js does: extractBlueprint first, then derive
  // sectionRoles from its output when bands were found.
  const blueprint = extractBlueprint(bands, [], { type: 'landing' }, { pageHeight: 1100, viewportHeight: 800 });
  const roles = sectionRolesFromBlueprint(blueprint);

  it('returns a sections array the same length as readingOrder, in the same order', () => {
    assert.ok(roles);
    assert.equal(roles.sections.length, roles.readingOrder.length);
    for (let i = 0; i < roles.sections.length; i++) {
      assert.equal(roles.sections[i].role, roles.readingOrder[i], `index ${i} role mismatch`);
      assert.equal(roles.sections[i].index, i);
    }
  });

  it('marks the source as blueprint and carries blueprint counts', () => {
    assert.equal(roles.source, 'blueprint');
    assert.deepEqual(roles.counts, blueprint.counts.byRole);
  });

  it('carries heading text and bounds through from the band', () => {
    const hero = roles.sections.find(s => s.role === 'hero');
    assert.ok(hero, JSON.stringify(roles.sections));
    assert.equal(hero.heading, 'Homes built to last');
    assert.equal(hero.bounds.y, 100);
    assert.deepEqual(hero.slots, { heading: 'Homes built to last' });
  });

  it('returns null for an empty blueprint, so the caller falls back to landmarks', () => {
    const empty = extractBlueprint([], [], null, { pageHeight: 0, viewportHeight: 800 });
    assert.equal(sectionRolesFromBlueprint(empty), null);
    assert.equal(sectionRolesFromBlueprint(null), null);
  });
});
