import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  loadSemanticGroundTruth,
  scoreSemanticExtraction,
  formatSemanticScorecard,
} from '../src/semantic-benchmark.js';

// Minimal valid ground-truth fixture, two reviewed sites + one unscored.
function makeGroundTruth(overrides = {}) {
  return {
    schemaVersion: 1,
    viewport: { width: 1440, height: 900 },
    sites: [
      {
        id: 'site-a',
        title: 'Site A',
        captureUrl: 'https://a.example.com/',
        capturedAt: '2026-09-01',
        captureStatus: 'reviewed',
        fonts: { accepted: ['Inter', 'Georgia'], rejected: ['Arial'] },
        geometry: { global: 'square', byRole: { button: 'square', card: 'rounded' } },
        mediaTopTwo: ['photography', 'ui-screenshot'],
        reviewer: 'human',
        notes: '',
      },
      {
        id: 'site-b',
        title: 'Site B',
        captureUrl: 'https://b.example.com/',
        capturedAt: '2026-09-01',
        captureStatus: 'reviewed',
        fonts: { accepted: ['Poppins'], rejected: ['Roboto'] },
        geometry: { global: 'pill', byRole: { button: 'pill' } },
        mediaTopTwo: ['illustration'],
        reviewer: 'human',
        notes: '',
      },
      {
        id: 'site-c',
        title: 'Site C',
        captureUrl: 'https://c.example.com/',
        capturedAt: '2026-09-01',
        captureStatus: 'unscored',
        unscoredReason: 'awaiting review',
        fonts: { accepted: [], rejected: [] },
        geometry: { global: null, byRole: {} },
        mediaTopTwo: [],
        reviewer: 'agent-pending-human',
        notes: '',
      },
    ],
    ...overrides,
  };
}

describe('loadSemanticGroundTruth · validation', () => {
  it('throws on duplicate site ids', () => {
    const gt = makeGroundTruth();
    gt.sites[1].id = 'site-a';
    assert.throws(() => loadSemanticGroundTruth(gt), /duplicate.*id/i);
  });

  it('throws on duplicate captureUrls after normalization', () => {
    const gt = makeGroundTruth();
    gt.sites[1].captureUrl = 'https://a.example.com'; // same as site-a, minus trailing slash
    assert.throws(() => loadSemanticGroundTruth(gt), /duplicate.*url/i);
  });

  it('throws on wrong schemaVersion', () => {
    const gt = makeGroundTruth({ schemaVersion: 2 });
    assert.throws(() => loadSemanticGroundTruth(gt), /schemaVersion/i);
  });

  it('throws on missing sites', () => {
    const gt = makeGroundTruth();
    delete gt.sites;
    assert.throws(() => loadSemanticGroundTruth(gt), /sites/i);
  });

  it('throws on invalid captureStatus', () => {
    const gt = makeGroundTruth();
    gt.sites[0].captureStatus = 'bogus';
    assert.throws(() => loadSemanticGroundTruth(gt), /captureStatus/i);
  });

  it('throws on a non-reviewed site without unscoredReason', () => {
    const gt = makeGroundTruth();
    gt.sites[2].unscoredReason = undefined;
    assert.throws(() => loadSemanticGroundTruth(gt), /unscoredReason/i);
  });

  it('throws on invalid geometry labels', () => {
    const gt = makeGroundTruth();
    gt.sites[0].geometry.global = 'triangle';
    assert.throws(() => loadSemanticGroundTruth(gt), /geometry/i);
  });

  it('throws on invalid media labels', () => {
    const gt = makeGroundTruth();
    gt.sites[0].mediaTopTwo = ['not-a-real-label'];
    assert.throws(() => loadSemanticGroundTruth(gt), /media/i);
  });

  it('loads a valid ground truth and normalizes it', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    assert.equal(gt.sites.length, 3);
    assert.equal(gt.sites[0].id, 'site-a');
  });

  it('loads the checked-in example fixture', async () => {
    const fs = await import('node:fs/promises');
    const raw = JSON.parse(
      await fs.readFile(new URL('../benchmarks/semantic-ground-truth-v1.example.json', import.meta.url)),
    );
    const gt = loadSemanticGroundTruth(raw);
    assert.ok(gt.sites.length >= 2);
    const statuses = gt.sites.map((s) => s.captureStatus);
    assert.ok(statuses.includes('reviewed'));
    assert.ok(statuses.some((s) => s !== 'reviewed'));
  });
});

describe('scoreSemanticExtraction · fonts', () => {
  it('counts a legitimate promoted font as retained (recall)', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { typography: { families: [{ name: 'Inter' }] } },
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    // site-a: 1/2 accepted retained, site-b: 1/1 retained -> 2/3 total
    assert.equal(score.fonts.acceptedTotal, 3);
    assert.equal(score.fonts.retained, 2);
    assert.equal(score.fonts.recall, 2 / 3);
    assert.equal(score.fonts.falsePositives, 0);
  });

  it('counts a malformed/rejected font promoted as a false positive', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { typography: { families: [{ name: 'Arial' }] } }, // rejected font promoted
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.fonts.falsePositives, 1);
    assert.equal(score.fonts.retained, 1); // only site-b's Poppins retained
  });

  it('prefers system.acceptedFamilies over families when both present', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': {
        typography: {
          system: { acceptedFamilies: [{ name: 'Inter' }, { name: 'Georgia' }] },
          families: [{ name: 'Arial' }], // should be ignored
        },
      },
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.fonts.falsePositives, 0);
    assert.equal(score.fonts.retained, 3); // Inter + Georgia + Poppins
  });
});

describe('scoreSemanticExtraction · geometry', () => {
  it('scores square-role preservation correctly', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': {
        borders: {
          geometry: {
            global: { value: 'square' },
            byRole: { button: { value: 'square' }, card: { value: 'rounded' } },
          },
        },
      },
      'site-b': { borders: { geometry: { global: { value: 'pill' }, byRole: { button: { value: 'pill' } } } } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.geometry.globalScored, 2);
    assert.equal(score.geometry.globalCorrect, 2);
    assert.equal(score.geometry.roleScored, 3);
    assert.equal(score.geometry.roleCorrect, 3);
    assert.equal(score.geometry.incidentalFlips, 0);
    assert.equal(score.geometry.accuracy, 1);
  });

  it('counts a square-truth site flipped to pill as an incidental flip', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { borders: { geometry: { global: { value: 'pill' }, byRole: {} } } },
      'site-b': { borders: { geometry: { global: { value: 'pill' }, byRole: {} } } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.geometry.incidentalFlips, 1); // only site-a's truth is 'square'
    assert.equal(score.geometry.globalCorrect, 1); // site-b pill/pill correct
  });
});

describe('scoreSemanticExtraction · media', () => {
  it('scores a media top-two recall hit', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { imageryStyle: { distribution: [{ label: 'photography' }, { label: 'logo' }] } },
      'site-b': { imageryStyle: { distribution: [{ label: 'illustration' }, { label: 'logo' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.media.scored, 2);
    assert.equal(score.media.hits, 2);
    assert.equal(score.media.recall, 1);
  });

  it('flags a photography false positive when truth has no photography label', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { imageryStyle: { distribution: [{ label: 'photography' }] } }, // truth includes photography: not FP
      'site-b': { imageryStyle: { distribution: [{ label: 'photography' }] } }, // truth is illustration: FP
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.media.photographyFalsePositives, 1);
    assert.equal(score.media.photographyFalsePositiveRate, 0.5);
  });

  it('maps legacy labels to current vocabulary before scoring', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { imageryStyle: { label: 'screenshot' } }, // legacy -> ui-screenshot, truth top-two includes it
      'site-b': { imageryStyle: { label: 'flat-illustration' } }, // legacy -> illustration, truth is illustration
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.media.hits, 2);
    assert.equal(score.media.recall, 1);
  });
});

describe('scoreSemanticExtraction · unscored handling', () => {
  it('excludes non-reviewed sites from every denominator', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { typography: { families: [{ name: 'Inter' }] } },
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
      'site-c': { typography: { families: [{ name: 'Comic Sans' }] } }, // present but unscored status
    };
    const score = scoreSemanticExtraction(gt, extractions);
    // site-c is captureStatus 'unscored' -> excluded even though an extraction exists
    assert.equal(score.fonts.acceptedTotal, 3); // only site-a(2) + site-b(1)
    assert.ok(score.unscored.some((u) => u.id === 'site-c'));
  });

  it('treats a reviewed site with no extraction as unscored with reason "no extraction"', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = { 'site-a': { typography: { families: [{ name: 'Inter' }] } } };
    const score = scoreSemanticExtraction(gt, extractions);
    const missing = score.unscored.find((u) => u.id === 'site-b');
    assert.ok(missing);
    assert.equal(missing.reason, 'no extraction');
    assert.equal(score.fonts.acceptedTotal, 2); // only site-a counted
  });
});

describe('scoreSemanticExtraction · defensive reading of malformed arrays', () => {
  it('skips a null entry in typography.families instead of crashing', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { typography: { families: [null, { name: 'Inter' }] } },
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.fonts.retained, 2); // Inter (site-a) + Poppins (site-b)
  });

  it('skips a null entry in typography.system.acceptedFamilies instead of crashing', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { typography: { system: { acceptedFamilies: [null, { name: 'Inter' }] } } },
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.fonts.retained, 2); // Inter (site-a) + Poppins (site-b)
  });

  it('skips a null entry in imageryStyle.distribution instead of crashing', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { imageryStyle: { distribution: [null, { label: 'photography' }] } },
      'site-b': { imageryStyle: { distribution: [{ label: 'illustration' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    assert.equal(score.media.hits, 2); // site-a photography hit + site-b illustration hit
  });

  it('one malformed site does not abort scoring for the rest of the run', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': { typography: { families: [null] } },
      'site-b': { typography: { families: [{ name: 'Poppins' }] } },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    // site-b still scores normally even though site-a's array contained a null.
    assert.equal(score.fonts.retained, 1);
    assert.equal(score.unscored.length, 1); // only site-c (unscored status)
  });
});

describe('formatSemanticScorecard', () => {
  it('prints n= counts and PASS/FAIL per gate', () => {
    const gt = loadSemanticGroundTruth(makeGroundTruth());
    const extractions = {
      'site-a': {
        typography: { families: [{ name: 'Inter' }, { name: 'Georgia' }] },
        borders: { geometry: { global: { value: 'square' }, byRole: {} } },
        imageryStyle: { distribution: [{ label: 'photography' }, { label: 'ui-screenshot' }] },
      },
      'site-b': {
        typography: { families: [{ name: 'Poppins' }] },
        borders: { geometry: { global: { value: 'pill' }, byRole: {} } },
        imageryStyle: { distribution: [{ label: 'illustration' }] },
      },
    };
    const score = scoreSemanticExtraction(gt, extractions);
    const card = formatSemanticScorecard(score);
    assert.match(card, /n=/);
    assert.match(card, /PASS|FAIL/);
    assert.match(card, /Font/i);
    assert.match(card, /Geometry/i);
    assert.match(card, /Media|Photography/i);
  });
});
