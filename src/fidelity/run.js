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
import { startSafeBrowsingProxy } from '../security/safe-proxy.js';

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Full-page screenshot through the safe browsing proxy, the same egress
// policy as the crawl. allowOrigin is the fidelity --clone-local allowance
// and is passed for the clone shot only. startProxy/launch are injectable so
// this proxied lane can be tested without a network or a real browser; the
// default behaviour (real proxy, real chromium) is unchanged.
export async function fullPageShot(url, { width = 1280, height = 800, channel, allowOrigin } = {},
  { startProxy = startSafeBrowsingProxy, launch = (o) => chromium.launch(o) } = {}) {
  const safeProxy = await startProxy(typeof allowOrigin === 'string' ? { allowOrigin } : {});
  let browser;
  try {
    browser = await launch({
      headless: true,
      ...(channel && { channel }),
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--proxy-bypass-list=<-loopback>'],
      proxy: { server: safeProxy.url },
    });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await safeProxy.close();
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
  const extractOpts = { ...(opts.extract || {}) };
  // Injectable for tests (a stub recording calls, or one that never touches
  // the network); default path is the real extractor/screenshot functions.
  const extractor = opts.extractor || extractDesignLanguage;
  const takeScreenshot = opts.screenshot || fullPageShot;

  // Motion is extracted from both sides via the normal pipeline. allowOrigin
  // (fidelity --clone-local) applies to the clone-side crawl only — the
  // original is never a loopback target.
  const cloneExtractOpts = opts.allowOrigin ? { ...extractOpts, allowOrigin: opts.allowOrigin } : extractOpts;
  const [originalDesign, cloneDesign] = await Promise.all([
    extractor(originalUrl, extractOpts),
    extractor(cloneUrl, cloneExtractOpts),
  ]);

  const motion = scoreMotionFidelity(originalDesign.motion, cloneDesign.motion, {
    originalChoreography: choreographyOf(originalDesign),
    cloneChoreography: choreographyOf(cloneDesign),
  });

  const blueprint = scoreBlueprintFidelity(originalDesign.blueprint, cloneDesign.blueprint);

  // Visual: pixel-diff full-page screenshots.
  let visualFidelity = null;
  let heatmap = null;
  const shotOpts = { width: opts.width, height: opts.height, channel: opts.channel };
  const [origShot, cloneShot] = await Promise.all([
    takeScreenshot(originalUrl, shotOpts),
    takeScreenshot(cloneUrl, opts.allowOrigin ? { ...shotOpts, allowOrigin: opts.allowOrigin } : shotOpts),
  ]);
  const diff = diffPngBuffers(origShot, cloneShot);
  visualFidelity = ratioToFidelity(diff.ratio);
  heatmap = diff.heatmap;

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
