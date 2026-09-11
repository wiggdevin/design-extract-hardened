import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrectionPlan } from '../src/fidelity/correction-plan.js';
import { combineFidelity, gradeFor, runFidelityLoop } from '../src/fidelity/index.js';

const verifyResult = {
  fidelity: 72,
  components: [
    {
      component: 'button', status: 'ok', fidelity: 68,
      attribution: [
        { family: 'shadow', moves: 0, unmapped: 2 },
        { family: 'color', moves: 3, unmapped: 0 },
      ],
    },
    {
      component: 'card', status: 'ok', fidelity: 76,
      attribution: [{ family: 'radius', moves: 1, unmapped: 0 }],
    },
    { component: 'input', status: 'n/a', reason: 'not found on page' },
  ],
};

const motionResult = {
  score: 55,
  aspects: [
    { aspect: 'feel', score: 0.5, weight: 2, gap: 'feels smooth, original feels springy', original: 'springy', clone: 'smooth' },
    { aspect: 'durations', score: 0.9, weight: 2, gap: null, original: [200], clone: [220] },
    { aspect: 'easings', score: 0.4, weight: 2, gap: 'clone is missing easing families: spring', original: ['spring'], clone: ['ease'] },
    { aspect: 'springs', score: 0, weight: 1.5, gap: 'original uses spring/overshoot easing the clone is missing', original: 1, clone: 0 },
    { aspect: 'keyframes', score: 1, weight: 1.5, gap: null, original: [], clone: [] },
    { aspect: 'scrollLinked', score: 1, weight: 1, gap: null, original: false, clone: false },
    { aspect: 'choreography', score: 1, weight: 1, gap: null, original: 0, clone: 0 },
  ],
};

describe('buildCorrectionPlan', () => {
  it('emits directives for unmapped tokens, snap-distance, and motion gaps', () => {
    const { directives, counts } = buildCorrectionPlan({ verify: verifyResult, motion: motionResult });
    assert.ok(directives.length > 0, 'produces directives');
    assert.ok(directives.some(d => d.area === 'visual' && d.aspect === 'shadow'), 'flags unmapped shadow tokens');
    assert.ok(directives.some(d => d.area === 'motion' && d.aspect === 'springs'), 'flags the missing spring');
    assert.ok(counts.visual > 0 && counts.motion > 0, 'counts both areas');
  });

  it('ranks the highest-gain directive first', () => {
    const { directives } = buildCorrectionPlan({ verify: verifyResult, motion: motionResult });
    for (let i = 1; i < directives.length; i++) {
      assert.ok(directives[i - 1].expectedGain >= directives[i].expectedGain, 'sorted by expectedGain desc');
    }
    // unmapped shadow (gain 6) should outrank a single color move (gain 3).
    const first = directives[0];
    assert.ok(first.expectedGain >= 4, `top directive should be high-impact, got ${first.expectedGain}`);
  });

  it('does not emit directives for aspects already above threshold', () => {
    const { directives } = buildCorrectionPlan({ verify: verifyResult, motion: motionResult });
    assert.ok(!directives.some(d => d.aspect === 'keyframes'), 'no directive for a passing aspect');
    assert.ok(!directives.some(d => d.aspect === 'durations'), 'durations at 0.9 is above the 0.75 threshold');
  });
});

describe('combineFidelity', () => {
  it('blends visual and motion with default weights', () => {
    const c = combineFidelity({ verify: verifyResult, motion: motionResult });
    // 72*0.6 + 55*0.4 = 43.2 + 22 = 65.2 -> 65
    assert.equal(c.overall, 65);
    assert.equal(c.grade, 'D');
    assert.equal(c.visual, 72);
    assert.equal(c.motion, 55);
    assert.ok(c.summary.includes('65%'), 'summary states the overall');
  });

  it('falls back to whichever signal is present', () => {
    assert.equal(combineFidelity({ verify: verifyResult }).overall, 72);
    assert.equal(combineFidelity({ motion: motionResult }).overall, 55);
    assert.equal(combineFidelity({}).overall, null);
  });
});

describe('gradeFor', () => {
  it('maps scores to letter grades', () => {
    assert.equal(gradeFor(95), 'A');
    assert.equal(gradeFor(85), 'B');
    assert.equal(gradeFor(72), 'C');
    assert.equal(gradeFor(61), 'D');
    assert.equal(gradeFor(40), 'F');
    assert.equal(gradeFor(null), 'unknown');
  });
});

describe('runFidelityLoop', () => {
  it('iterates until it crosses the threshold, applying corrections each round', async () => {
    let visual = 60, motion = 50;
    const rebuilds = [];
    const result = await runFidelityLoop({
      measure: () => ({
        verify: { fidelity: visual, components: [] },
        motion: { score: motion, aspects: [{ aspect: 'feel', score: 0.4, weight: 2, gap: 'x', original: 'springy', clone: 'smooth' }] },
      }),
      rebuild: (plan, round) => { rebuilds.push(round); visual += 15; motion += 18; },
      threshold: 90,
      maxRounds: 5,
    });
    assert.ok(result.converged, 'loop converges');
    assert.ok(result.final.overall >= 90, `final crosses threshold, got ${result.final.overall}`);
    assert.ok(result.rounds.length >= 2, 'took multiple rounds');
    assert.ok(rebuilds.length === result.rounds.length - 1, 'rebuilds once between each measured round');
  });

  it('stops at maxRounds without converging when corrections stall', async () => {
    const result = await runFidelityLoop({
      measure: () => ({
        verify: { fidelity: 50, components: [] },
        motion: { score: 50, aspects: [{ aspect: 'feel', score: 0.3, weight: 2, gap: 'x', original: 'springy', clone: 'smooth' }] },
      }),
      rebuild: () => {}, // no improvement
      threshold: 90,
      maxRounds: 3,
    });
    assert.equal(result.converged, false, 'never converges');
    assert.equal(result.rounds.length, 3, 'respects the round budget');
  });

  it('stops early when there are no directives left', async () => {
    const result = await runFidelityLoop({
      measure: () => ({ verify: { fidelity: 80, components: [] }, motion: { score: 82, aspects: [] } }),
      threshold: 95,
      maxRounds: 4,
    });
    assert.equal(result.rounds.length, 1, 'no corrections → stop after first measure');
    assert.ok(result.converged, 'a measured score with nothing to fix counts as converged');
  });

  it('throws without a measure function', async () => {
    await assert.rejects(() => runFidelityLoop({}), /measure/);
  });
});

import { measureCloneFidelity, fullPageShot } from '../src/fidelity/run.js';

describe('measureCloneFidelity input guard', () => {
  it('rejects a missing clone URL before touching a browser', async () => {
    await assert.rejects(measureCloneFidelity({ originalUrl: 'https://example.com' }), /needs originalUrl and cloneUrl/);
  });
});

describe('measureCloneFidelity: allowOrigin threads to the clone-side crawl only', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const stubDesign = {
    motion: { runtime: null },
    blueprint: { bands: [], readingOrder: [], heroIndex: -1, counts: { bands: 0, oversizedDropped: 0, byRole: {} } },
  };

  it('the original call has no allowOrigin key; the clone call carries the loopback origin', async () => {
    const calls = [];
    const extractor = async (url, options) => { calls.push({ url, options }); return stubDesign; };
    const screenshot = async () => PNG;

    const { report } = await measureCloneFidelity({
      originalUrl: 'https://example.com',
      cloneUrl: 'http://127.0.0.1:4173',
      opts: { extractor, screenshot, allowOrigin: 'http://127.0.0.1:4173' },
    });

    assert.equal(calls.length, 2);
    const original = calls.find((c) => c.url === 'https://example.com');
    const clone = calls.find((c) => c.url === 'http://127.0.0.1:4173');
    assert.ok(original, JSON.stringify(calls));
    assert.ok(!('allowOrigin' in original.options), JSON.stringify(original.options));
    assert.ok(clone, JSON.stringify(calls));
    assert.equal(clone.options.allowOrigin, 'http://127.0.0.1:4173');
    assert.ok(report);
  });
});

describe('measureCloneFidelity: the screenshot lane is proxied and allowOrigin reaches the clone shot only', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const stubDesign = { motion: { runtime: null }, blueprint: { bands: [], readingOrder: [], heroIndex: -1, counts: { bands: 0, oversizedDropped: 0, byRole: {} } } };
  it('records one shot per side with allowOrigin only on the clone', async () => {
    const shots = [];
    const screenshot = async (url, o) => { shots.push({ url, o }); return PNG; };
    await measureCloneFidelity({
      originalUrl: 'https://example.com', cloneUrl: 'http://127.0.0.1:4173',
      opts: { extractor: async () => stubDesign, screenshot, allowOrigin: 'http://127.0.0.1:4173' },
    });
    assert.equal(shots.length, 2);
    const original = shots.find((s) => s.url === 'https://example.com');
    const clone = shots.find((s) => s.url === 'http://127.0.0.1:4173');
    assert.ok(!('allowOrigin' in original.o), JSON.stringify(original.o));
    assert.equal(clone.o.allowOrigin, 'http://127.0.0.1:4173');
  });
});

describe('fullPageShot: goes through the safe browsing proxy with injectable startProxy/launch', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fakePage = () => ({
    goto: async () => {},
    waitForLoadState: async () => {},
    evaluate: async () => {},
    screenshot: async () => PNG,
  });
  const fakeLaunch = (launchCalls) => async (options) => {
    launchCalls.push(options);
    return {
      newContext: async () => ({ newPage: async () => fakePage() }),
      close: async () => {},
    };
  };

  it('starts the proxy with allowOrigin and launches with its url and the egress args', async () => {
    const proxyCalls = [];
    const startProxy = async (options) => { proxyCalls.push(options); return { url: 'http://127.0.0.1:9', close: async () => {} }; };
    const launchCalls = [];
    const buf = await fullPageShot('http://127.0.0.1:4173', { allowOrigin: 'http://127.0.0.1:4173' }, { startProxy, launch: fakeLaunch(launchCalls) });

    assert.deepEqual(proxyCalls, [{ allowOrigin: 'http://127.0.0.1:4173' }]);
    assert.equal(launchCalls[0].proxy.server, 'http://127.0.0.1:9');
    assert.ok(launchCalls[0].args.includes('--disable-quic'), JSON.stringify(launchCalls[0].args));
    assert.ok(launchCalls[0].args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'), JSON.stringify(launchCalls[0].args));
    assert.ok(launchCalls[0].args.includes('--proxy-bypass-list=<-loopback>'), JSON.stringify(launchCalls[0].args));
    assert.deepEqual(buf, PNG);
  });

  it('starts the proxy with {} when no allowOrigin is given', async () => {
    const proxyCalls = [];
    const startProxy = async (options) => { proxyCalls.push(options); return { url: 'http://127.0.0.1:9', close: async () => {} }; };
    await fullPageShot('http://127.0.0.1:4173', {}, { startProxy, launch: fakeLaunch([]) });
    assert.deepEqual(proxyCalls, [{}]);
  });
});

describe('measureCloneFidelity: a rejection on one side of a paired launch does not race the other', () => {
  const stubDesign = { motion: { runtime: null }, blueprint: { bands: [], readingOrder: [], heroIndex: -1, counts: { bands: 0, oversizedDropped: 0, byRole: {} } } };

  it('rejects with the screenshot error once both sides have settled, closing normally', async () => {
    const cloneError = new Error('clone screenshot failed');
    let originalClosed = false;
    const screenshot = async (url) => {
      if (url === 'http://127.0.0.1:4173') throw cloneError;
      // The original side resolves slower than the clone rejects, so a plain
      // Promise.all would already have returned (and rejected) before this
      // settles — Promise.allSettled must still wait for it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      originalClosed = true;
      return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    };
    await assert.rejects(
      measureCloneFidelity({
        originalUrl: 'https://example.com', cloneUrl: 'http://127.0.0.1:4173',
        opts: { extractor: async () => stubDesign, screenshot },
      }),
      (error) => error === cloneError,
    );
    assert.equal(originalClosed, true, 'the original-side promise must be allowed to settle, not abandoned');
  });
});
