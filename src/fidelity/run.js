// Orchestrate a clone-vs-original fidelity measurement.
//
// Visual: full-page screenshot of each, pixel-diffed (reusing verify's
// letterbox diff). Motion: extractMotion() for each, scored by motion-fidelity.
// The two fold into one combined report + a loss heatmap. Live browser + URLs,
// so this is the integration layer; the scoring it calls is unit-tested.

import { chromium } from 'playwright';
import { extractDesignLanguage } from '../index.js';
import { diffPngBuffers, ratioToFidelity } from '../verify/diff.js';
import { scoreMotionFidelity } from './motion-fidelity.js';
import { combineFidelity } from './index.js';
import { scoreBlueprintFidelity } from './blueprint-fidelity.js';

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

async function fullPageShot(browser, url, { width = 1280, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await context.close();
  }
}

function choreographyOf(design) {
  return design?.motion?.runtime?.choreography || [];
}

/**
 * Measure how faithfully `cloneUrl` reproduces `originalUrl`.
 * @returns {{ report:object, heatmap:Buffer|null }}
 */
export async function measureCloneFidelity({ originalUrl, cloneUrl, opts = {} } = {}) {
  if (!originalUrl || !cloneUrl) throw new Error('measureCloneFidelity needs originalUrl and cloneUrl');
  const browserOpts = opts.channel ? { channel: opts.channel } : {};
  const extractOpts = { ...(opts.extract || {}) };

  // Motion is extracted from both sides via the normal pipeline. allowOrigin
  // (fidelity --clone-local) applies to the clone-side crawl only — the
  // original is never a loopback target.
  const cloneExtractOpts = opts.allowOrigin ? { ...extractOpts, allowOrigin: opts.allowOrigin } : extractOpts;
  const [originalDesign, cloneDesign] = await Promise.all([
    extractDesignLanguage(originalUrl, extractOpts),
    extractDesignLanguage(cloneUrl, cloneExtractOpts),
  ]);

  const motion = scoreMotionFidelity(originalDesign.motion, cloneDesign.motion, {
    originalChoreography: choreographyOf(originalDesign),
    cloneChoreography: choreographyOf(cloneDesign),
  });

  const blueprint = scoreBlueprintFidelity(originalDesign.blueprint, cloneDesign.blueprint);

  // Visual: pixel-diff full-page screenshots.
  let visualFidelity = null;
  let heatmap = null;
  const browser = await chromium.launch({ headless: true, ...browserOpts });
  try {
    const [origShot, cloneShot] = await Promise.all([
      fullPageShot(browser, originalUrl, opts),
      fullPageShot(browser, cloneUrl, opts),
    ]);
    const diff = diffPngBuffers(origShot, cloneShot);
    visualFidelity = ratioToFidelity(diff.ratio);
    heatmap = diff.heatmap;
  } finally {
    await browser.close();
  }

  const verify = { fidelity: visualFidelity, components: [] };
  const combined = combineFidelity({ verify, motion });

  const report = {
    host: hostOf(originalUrl),
    url: originalUrl,
    cloneUrl,
    generatedAt: new Date().toISOString(),
    ...combined,
    motionAspects: motion.aspects,
    blueprint,
  };

  return { report, heatmap };
}
