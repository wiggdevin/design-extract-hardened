import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { extractMediaDarkColors } from './extractors/dark-mode-pair.js';
import { startScreencast } from './screencast.js';
import { startSafeBrowsingProxy } from './security/safe-proxy.js';
import { createResponseLedger, selectPixelCandidates, collectPixelEvidence } from './pixel-lane.js';
import { neutralizeConsent } from './consent.js';

const MAX_ELEMENTS = 5000;
const NETWORK_OVERRIDE_FLAGS = [
  '--host-resolver-rules',
  '--no-proxy-server',
  '--proxy-auto-detect',
  '--proxy-bypass-list',
  '--proxy-pac-url',
  '--proxy-server',
];

function keepsNetworkPolicy(browserArg) {
  return !NETWORK_OVERRIDE_FLAGS.some((flag) => browserArg === flag || browserArg.startsWith(`${flag}=`));
}

async function gotoWithRetry(page, url, opts, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, opts);
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await page.waitForTimeout(2000 * (i + 1));
    }
  }
}

export async function crawlPage(url, options = {}) {
  const {
    width = 1280, height = 800, wait = 0, dark = false, depth = 0,
    screenshots = false, outDir = '', executablePath, browserArgs,
    cookies, headers, ignore,
    insecure = false,
    userAgent,
    deepInteract = false,
    motionRuntime = false,
    selector,
    channel,
    wsEndpoint,
    onScreencastFrame,  // Theatre: opt-in live frame sink. When set, a throttled
    screencastOpts,     // CDP screencast streams what the page paints during load.
    pixelEvidence = true, // Pixel lane: features of images the page loaded (no extra fetch).
    dismissConsent = true, // Reject or hide a consent banner before measuring. Never accepts.
    scrollPass = true, // Shared viewport-step scroll pass so lazy images and reveal animations fire.
    allowOrigin,
  } = options;

  const launchArgs = [
    ...(browserArgs || []).filter(keepsNetworkPolicy),
    // Common flags that help with dev environments and CI. Insecure-only flags
    // are added below when the user opts in.
    '--disable-dev-shm-usage',
  ];
  if (insecure) {
    launchArgs.push('--ignore-certificate-errors', '--ignore-ssl-errors');
  }

  // A browser running on another host can reach networks this process cannot
  // police. Fail closed until the remote service can enforce the same policy.
  if (wsEndpoint) {
    throw new Error('Remote browser endpoints are disabled because private-network egress cannot be enforced');
  }

  // Chromium sends every top-level navigation, redirect, and subresource
  // through this proxy. The proxy resolves each destination itself, rejects
  // any private/special-use answer, and connects to the validated IP rather
  // than allowing a second DNS lookup (DNS-rebinding protection).
  // allowOrigin is the one loopback allowance (fidelity --clone-local). The
  // proxy validates its shape again; anything else is ignored here.
  const safeProxy = await startSafeBrowsingProxy(typeof allowOrigin === 'string' ? { allowOrigin } : {});
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath && { executablePath }),
      // channel: 'chrome' forces Playwright to use the system Chrome install
      // instead of the 150MB bundled Chromium — see --system-chrome.
      ...(channel && { channel }),
      args: [
        ...launchArgs,
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--proxy-bypass-list=<-loopback>',
      ],
      proxy: { server: safeProxy.url },
    });
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: 'light',
      ignoreHTTPSErrors: insecure,
      ...(userAgent && { userAgent }),
      ...(headers && { extraHTTPHeaders: headers }),
    });

    // Set cookies if provided
    if (cookies && cookies.length > 0) {
      await context.addCookies(cookies.map(c => {
        if (typeof c === 'string') {
          const [name, ...rest] = c.split('=');
          return { name, value: rest.join('='), url };
        }
        return c;
      }));
    }
    const page = await context.newPage();

    // Pixel lane: remember the raster bodies Chromium receives for this page
    // (through the safe proxy, no extra requests) so media classification can
    // read pixels the DOM cannot describe. Bytes never leave this function.
    const ledger = pixelEvidence ? createResponseLedger(page) : null;

    // Theatre (opt-in): tap what Chromium paints and stream it to the caller as
    // throttled JPEG frames. Best-effort — a screencast that won't start must
    // never break the extraction, so it's wrapped and degrades to silence.
    let screencast = null;
    if (typeof onScreencastFrame === 'function') {
      try {
        const cdp = await context.newCDPSession(page);
        screencast = await startScreencast(cdp, onScreencastFrame, screencastOpts || {});
      } catch {
        screencast = null;
      }
    }

    // Start CSS coverage for css-health audit. Not supported on all targets —
    // fail gracefully and set empty coverage if the API is unavailable.
    let cssCoverageAvailable = true;
    try {
      await page.coverage.startCSSCoverage();
    } catch { cssCoverageAvailable = false; }

    await gotoWithRetry(page, url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for network to settle — but don't hang on sites with persistent connections
    await page.waitForLoadState('networkidle').catch(() => {});
    if (wait > 0) await page.waitForTimeout(wait);
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    // Consent banner: refuse or hide it, and release its scroll lock, before
    // coverage, the scroll pass, the collector, the pixel lane, and screenshots
    // see the page. See consent.js for what is and is not pressed.
    let consent = null;
    if (dismissConsent) {
      consent = await neutralizeConsent(page);
      if (consent.action !== 'none') await page.waitForTimeout(250);
    }

    // Capture CSS coverage after the page has settled.
    let cssCoverage = [];
    if (cssCoverageAvailable) {
      try {
        const raw = await page.coverage.stopCSSCoverage();
        cssCoverage = raw.map(c => ({
          url: c.url,
          text: c.text,
          totalBytes: (c.text || '').length,
          ranges: c.ranges || [],
        }));
      } catch { cssCoverage = []; }
    }

    const title = await page.title();

    // Shared scroll pass: viewport steps so lazy images and reveal observers
    // fire for every band. Runtime motion reads scroll animations per step.
    let scroll = null;
    const scrollObservations = [];
    if (scrollPass) {
      scroll = await scrollThroughPage(page, {
        // Called twice per step ('early' and 'settled' — see
        // scrollThroughPage); pushed both times so a reveal that has already
        // finished by the settled read is still caught early. Exact
        // duplicates across the two phases collapse in processRuntimeMotion.
        onStep: motionRuntime
          ? async (_i, _phase) => { scrollObservations.push(...await readRuntimeAnimations(page, 'scroll')); }
          : undefined,
      }).catch(() => null);
      if (scroll) scroll.images = await waitForImages(page);
    }

    // Auto-interact pass (Tier 2): open menus, hover, open accordions & a first modal.
    let interactState = null;
    if (deepInteract) {
      interactState = await runInteractionPass(page).catch(() => null);
    }

    // Runtime motion capture (Motion v3, opt-in): load + hover/focus reads,
    // merged with the scroll observations from the shared pass.
    let motionRuntimeObs = null;
    if (motionRuntime) {
      motionRuntimeObs = await captureRuntimeMotion(page, { scrollObservations }).catch(() => null);
    }

    // The interaction and runtime-motion passes above scroll elements into
    // view via Playwright's actionability checks, so the page may be
    // scrolled away from the top here; sections and bands both compute
    // document-relative y from window.scrollY, so reset the window scroller
    // before collecting (instant, so a smooth scroll-behavior page cannot
    // still be mid-flight when the settle wait expires).
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })).catch(() => {});
    await page.waitForTimeout(200);

    const lightData = await extractPageData(page, ignore, selector);
    lightData.cssCoverage = cssCoverage;
    lightData.consent = consent;
    lightData.scroll = scroll;
    if (ledger) {
      try {
        const candidates = selectPixelCandidates({
          images: lightData.images || [],
          backgroundMedia: lightData.backgroundMedia || [],
          viewport: lightData.viewport || { width, height },
          baseUrl: page.url(),
        });
        const { evidence, summary } = await collectPixelEvidence({ page, ledger, candidates });
        lightData.pixelEvidence = evidence;
        lightData.pixelSummary = { ...summary, ledgerEntries: ledger.entries.size, ledgerBytes: ledger.bytes, ledgerDropped: ledger.dropped };
      } catch (err) {
        lightData.pixelEvidence = [];
        lightData.pixelSummary = { unavailable: `pixel lane failed: ${String(err?.message || err).slice(0, 100)}` };
      } finally {
        ledger.stop();
        ledger.clear();
      }
    }
    if (interactState) lightData.interactState = interactState;
    if (motionRuntimeObs) lightData.motionRuntime = motionRuntimeObs;

    // The visually interesting window (load + auto-interact) is done — stop the
    // cast before any multipage navigation or dark-mode context swap, which
    // would just stream confusing reloads.
    if (screencast) {
      try { await screencast.stop(); } catch { /* already stopped */ }
      screencast = null;
    }

    // Component screenshots
    let componentScreenshots = {};
    if (screenshots && outDir) {
      componentScreenshots = await captureComponentScreenshots(page, outDir);
    }

    // Issue #110: capture the prefers-color-scheme dark colours before the depth
    // crawl below navigates `page` to internal routes. Reading them after the crawl
    // would sample the last internal page instead of the requested URL.
    let mediaColors = null;
    if (dark) {
      mediaColors = await extractMediaDarkColors(page).catch(() => null);
    }

    // Multi-page crawl: discover internal links and extract from them
    let additionalPages = [];
    const routes = [];
    if (depth > 0) {
      // Seed routes with the primary page
      try {
        const u0 = new URL(url);
        routes.push({
          url,
          path: u0.pathname || '/',
          computedStylesSample: (lightData.computedStyles || []).slice(0, 2000),
        });
      } catch { /* ignore */ }
      const internalLinks = await discoverInternalLinks(page, url, depth);
      for (const link of internalLinks) {
        try {
          await gotoWithRetry(page, link, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.evaluate(() => document.fonts.ready).catch(() => {});
          if (dismissConsent) await neutralizeConsent(page);
          const pageData = await extractPageData(page);
          additionalPages.push({ url: link, data: pageData });
          try {
            const u = new URL(link);
            routes.push({
              url: link,
              path: u.pathname || '/',
              computedStylesSample: (pageData.computedStyles || []).slice(0, 2000),
            });
          } catch { /* ignore */ }
        } catch { /* skip failed pages */ }
      }
    }

    // Dark mode extraction
    let darkData = null;
    if (dark) {
      await context.close();
      const darkContext = await browser.newContext({
        viewport: { width, height },
        colorScheme: 'dark',
      });
      const darkPage = await darkContext.newPage();
      await gotoWithRetry(darkPage, url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await darkPage.waitForLoadState('networkidle').catch(() => {});
      await darkPage.evaluate(() => document.fonts.ready).catch(() => {});
      if (dismissConsent) await neutralizeConsent(darkPage);
      darkData = await extractPageData(darkPage);
      darkData.mediaColors = mediaColors;
      await darkContext.close();
    } else {
      await context.close();
    }

    // Merge additional page data into light data
    if (additionalPages.length > 0) {
      lightData.computedStyles = mergeStyles(lightData.computedStyles, additionalPages);
      for (const ap of additionalPages) {
        Object.assign(lightData.cssVariables, ap.data.cssVariables);
        lightData.mediaQueries.push(...ap.data.mediaQueries);
        lightData.keyframes.push(...ap.data.keyframes);
        if (ap.data.fluidValues) {
          lightData.fluidValues = [...(lightData.fluidValues || []), ...ap.data.fluidValues];
        }
      }
      // Deduplicate media queries and keyframes
      lightData.mediaQueries = [...new Set(lightData.mediaQueries)];
      const seenKf = new Set();
      lightData.keyframes = lightData.keyframes.filter(kf => {
        if (seenKf.has(kf.name)) return false;
        seenKf.add(kf.name);
        return true;
      });
    }

    return {
      url, title,
      light: lightData,
      dark: darkData,
      interactState,
      routes: routes.length > 0 ? routes : undefined,
      pagesAnalyzed: 1 + additionalPages.length,
      componentScreenshots,
    };
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await safeProxy.close();
    }
  }
}

function mergeStyles(primary, additionalPages) {
  // Add styles from additional pages, capping total
  const all = [...primary];
  for (const ap of additionalPages) {
    if (all.length >= MAX_ELEMENTS * 2) break;
    all.push(...ap.data.computedStyles);
  }
  return all;
}

async function discoverInternalLinks(page, baseUrl, maxLinks) {
  const base = new URL(baseUrl);
  const links = await page.evaluate((hostname) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(href => {
        try {
          const u = new URL(href);
          return u.hostname === hostname && !href.includes('#') && !href.match(/\.(png|jpg|jpeg|gif|svg|pdf|zip|mp4|mp3)$/i);
        } catch { return false; }
      });
  }, base.hostname);

  // Deduplicate and limit
  const unique = [...new Set(links)].filter(l => l !== baseUrl);
  return unique.slice(0, Math.min(maxLinks * 3, 15)); // crawl up to 15 pages max
}

export async function captureComponentScreenshots(page, outDir) {
  const screenshotDir = join(outDir, 'screenshots');
  mkdirSync(screenshotDir, { recursive: true });

  const result = {};

  // Find representative elements for each component type
  const selectors = [
    { name: 'button', selector: 'button:not(:empty), a[role="button"], [class*="btn"]:not(:empty)', label: 'Buttons' },
    { name: 'card', selector: '[class*="card"]:not(:empty)', label: 'Cards' },
    { name: 'input', selector: 'input[type="text"], input[type="email"], input[type="search"], textarea', label: 'Inputs' },
    { name: 'nav', selector: 'nav, [role="navigation"]', label: 'Navigation' },
    { name: 'hero', selector: '[class*="hero"], section:first-of-type', label: 'Hero Section' },
  ];

  for (const { name, selector, label } of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.width > 20 && box.height > 10) {
          const path = join(screenshotDir, `${name}.png`);
          await el.screenshot({ path });
          result[name] = { path: `screenshots/${name}.png`, label };
        }
      }
    } catch { /* skip if screenshot fails */ }
  }

  // Full page screenshot
  try {
    const fullPath = join(screenshotDir, 'full-page.png');
    await page.screenshot({ path: fullPath, fullPage: true });
    result.fullPage = { path: 'screenshots/full-page.png', label: 'Full Page' };
  } catch { /* skip */ }

  return result;
}

async function snapshotSelector(page, selector) {
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        color: cs.color, backgroundColor: cs.backgroundColor,
        borderColor: cs.borderColor, boxShadow: cs.boxShadow,
        transform: cs.transform, opacity: cs.opacity,
        outline: cs.outline, textDecoration: cs.textDecoration,
      };
    }, selector);
  } catch { return null; }
}

// One shared scroll pass. Steps by the viewport height so lazy loaders and
// intersection observers fire for every band, settles briefly per step, then
// returns to the top. Capped so a very tall page cannot run away with the crawl.
export async function scrollThroughPage(page, { stepPx, maxSteps = 60, settleMs = 150, idleMs = 1000, onStep } = {}) {
  // Page height: the larger of the document's own scrollHeight and the
  // tallest scrollHeight among the first 2500 full-width elements in
  // document order, not counting <head> and its descendants or
  // non-rendering tags (script/style/link/meta/etc.). Probed live: on N26
  // the real scroll container sits at counted index ~293 (past a large
  // <head> plus srcset <source> boilerplate); on Emma Lewisham, a Shopify
  // theme with several hidden app widgets (cart drawer, search modal,
  // consent widget) ahead of it in document order, the real content wrapper
  // sits past index 1200. 300, the figure this was originally sized to, does
  // not reach either live site; 2500 covers both with a wide margin and is
  // still a single cheap pass (no style computation, just tag/rect checks).
  // Same expression as collectPageData's results.pageHeight (that one is
  // serialized into the page separately and must stay self-contained, so it
  // is duplicated there rather than shared). If the tallest such element is
  // itself scrollable and taller than the document by more than one
  // viewport, it is an inner scroll container (or a transformed scroll
  // library, e.g. Locomotive Scroll) and the pass scrolls it too, stashed on
  // `window` for the per-step evaluates below and cleared at the end.
  const { pageHeightPx } = await page.evaluate(() => {
    const docHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const vw = window.innerWidth;
    const SKIP_TAG = /^(script|style|link|template|noscript|source|track|title|base|meta)$/;
    let tallest = null;
    let tallestHeight = 0;
    let counted = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('head') || SKIP_TAG.test(el.tagName.toLowerCase()) || el.ownerSVGElement) continue;
      if (counted++ >= 2500) break;
      if (el.getBoundingClientRect().width < vw * 0.9) continue;
      if (el.scrollHeight > tallestHeight) { tallestHeight = el.scrollHeight; tallest = el; }
    }
    const pageHeightPx = Math.max(docHeight, tallestHeight);
    let scroller = null;
    if (tallest && tallestHeight > docHeight + window.innerHeight) {
      const overflowY = getComputedStyle(tallest).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') scroller = tallest;
    }
    window.__designlangScroller = scroller;
    return { pageHeightPx };
  }).catch(() => ({ pageHeightPx: 0 }));
  const scroller = (await page.evaluate(() => !!window.__designlangScroller).catch(() => false)) ? 'element' : 'window';
  const viewportHeight = (page.viewportSize() || {}).height || 800;
  const step = stepPx || viewportHeight;
  const needed = Math.max(1, Math.ceil(Math.max(0, pageHeightPx - viewportHeight) / step));
  const steps = Math.min(needed, maxSteps);
  for (let i = 1; i <= steps; i++) {
    // Scroll the inner container AND the window on every step, not one or
    // the other: a page can have both a scrolling document and a taller
    // inner pane, and an `else` here would leave the document never
    // advancing. Guard with isConnected so a scroller element detached
    // mid-pass (an SPA re-render swapping it out) doesn't leave a stale
    // truthy reference that silently scrolls nothing for the rest of the
    // pass — window.scrollTo still runs regardless.
    await page.evaluate((y) => {
      const s = window.__designlangScroller;
      if (s && s.isConnected) s.scrollTo(0, y);
      window.scrollTo(0, y);
    }, i * step).catch(() => {});
    // Two reads per step: 'early', ~60ms after the scroll, while a
    // 0.3-1s reveal animation (fadeUp-on-scroll, etc.) is still running, and
    // 'settled' after the usual settle + networkidle wait, by which point a
    // short reveal has already finished and document.getAnimations() no
    // longer lists it. Reading only 'settled' was why reveals came back
    // empty on pages whose animations are shorter than the settle window.
    await page.waitForTimeout(60);
    if (typeof onStep === 'function') await onStep(i, 'early');
    await page.waitForTimeout(Math.max(0, settleMs - 60));
    await page.waitForLoadState('networkidle', { timeout: idleMs }).catch(() => {});
    if (typeof onStep === 'function') await onStep(i, 'settled');
  }
  await page.evaluate(() => {
    const s = window.__designlangScroller;
    if (s && s.isConnected) s.scrollTo(0, 0);
    window.scrollTo(0, 0);
    delete window.__designlangScroller;
  }).catch(() => {});
  // Best-effort cleanup regardless of whether the scroll-back above threw
  // partway through (e.g. a detached scroller's scrollTo): a stale
  // __designlangScroller would otherwise leak into later evaluates.
  await page.evaluate(() => { delete window.__designlangScroller; }).catch(() => {});
  await page.waitForTimeout(200);
  return {
    steps,
    coveredPx: Math.min(steps * step + viewportHeight, pageHeightPx),
    pageHeightPx,
    scroller,
    capped: needed > maxSteps,
  };
}

// Wait (bounded) for every image with a source to finish loading.
export async function waitForImages(page, { timeoutMs = 3000 } = {}) {
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => !img.getAttribute('src') || img.complete),
    null,
    { timeout: timeoutMs },
  ).catch(() => {});
  return page.evaluate(() => {
    const withSrc = Array.from(document.images).filter((img) => img.getAttribute('src'));
    const isPlaceholder = (s) => !s || /^data:/i.test(s);
    // placeholders counts every document.images entry with a placeholder src
    // (any lazy-load attribute present), while total counts only images with
    // a src attribute — a lazy image with no src at all is still a
    // placeholder, so placeholders can exceed total.
    const placeholders = Array.from(document.images).filter((img) => isPlaceholder(img.currentSrc || img.getAttribute('src') || '')
      && ['data-orig-src', 'data-src', 'data-lazy-src', 'data-srcset'].some((a) => img.hasAttribute(a))).length;
    return { total: withSrc.length, incomplete: withSrc.filter((img) => !img.complete).length, placeholders };
  }).catch(() => ({ total: 0, incomplete: 0, placeholders: 0 }));
}

async function runInteractionPass(page) {
  const state = {
    scrollSettled: false,
    menusOpened: 0,
    hoverSamples: [],
    accordionsOpened: 0,
    modals: [],
  };

  // 1) The shared scroll pass already ran in crawlPage; nothing to scroll here.
  state.scrollSettled = true;

  // 2) Open menus / dropdowns
  try {
    const triggers = await page.$$('nav [aria-haspopup], [aria-expanded="false"], .menu-toggle, .hamburger, [data-menu]');
    for (const t of triggers.slice(0, 5)) {
      try {
        await t.click({ timeout: 1000, trial: false });
        state.menusOpened++;
      } catch { /* ignore */ }
    }
    await page.waitForTimeout(400);
  } catch { /* ignore */ }

  // 3) Hover up to 6 buttons + 6 links with style diffs
  try {
    const btnSelectors = await page.evaluate(() => {
      const arr = [];
      const btns = Array.from(document.querySelectorAll('button')).slice(0, 6);
      btns.forEach((el, i) => arr.push(`button:nth-of-type(${i + 1})`));
      return arr;
    });
    const linkSelectors = await page.evaluate(() => {
      const arr = [];
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 6);
      links.forEach((el, i) => arr.push(`a[href]:nth-of-type(${i + 1})`));
      return arr;
    });
    const samples = [...(btnSelectors || []), ...(linkSelectors || [])].slice(0, 12);
    for (const sel of samples) {
      const before = await snapshotSelector(page, sel);
      if (!before) continue;
      try {
        await page.hover(sel, { timeout: 500 });
        await page.waitForTimeout(100);
        const after = await snapshotSelector(page, sel);
        if (after) state.hoverSamples.push({ selector: sel, before, after });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // 4) Accordions / details
  try {
    const accs = await page.$$('details, [role="tab"], [data-accordion]');
    for (const a of accs.slice(0, 6)) {
      try {
        await a.click({ timeout: 800 });
        state.accordionsOpened++;
      } catch { /* ignore */ }
    }
    await page.waitForTimeout(200);
  } catch { /* ignore */ }

  // 5) First triggerable modal / dialog
  try {
    const candidates = await page.$$('button, a[role="button"]');
    let triggered = false;
    for (const c of candidates.slice(0, 30)) {
      if (triggered) break;
      try {
        const txt = (await c.innerText({ timeout: 500 }).catch(() => '')) || '';
        if (!/sign\s*in|log\s*in|menu|open|subscribe/i.test(txt)) continue;
        await c.click({ timeout: 2000 });
        await page.waitForTimeout(600);
        const snapshot = await page.evaluate(() => {
          const dlg = document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]');
          if (!dlg) return null;
          const cs = getComputedStyle(dlg);
          const r = dlg.getBoundingClientRect();
          return {
            tag: dlg.tagName.toLowerCase(),
            role: dlg.getAttribute('role') || '',
            bg: cs.backgroundColor,
            color: cs.color,
            boxShadow: cs.boxShadow,
            borderRadius: cs.borderRadius,
            width: r.width,
            height: r.height,
          };
        });
        if (snapshot) {
          state.modals.push({ trigger: txt.slice(0, 60), snapshot });
          triggered = true;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(200);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return state;
}

// In-page reader. mode = { trigger, selector? }. Serializes running animations
// (CSS animations + transitions + WAAPI) into plain objects, including each
// target's document-relative box so reveal matching (Task 4) can line an
// observation up with the scroll step that would have revealed it.
const READ_ANIMATIONS = (mode) => {
  const { trigger, selector } = mode;
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      let part = node.tagName.toLowerCase();
      if (node.id) { part += `#${node.id}`; parts.unshift(part); break; }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ').slice(0, 200);
  };
  const serialize = (anim) => {
    try {
      const eff = anim.effect;
      if (!eff || typeof eff.getTiming !== 'function') return null;
      const t = eff.getTiming();
      const target = eff.target;
      if (selector && target && target.closest && !target.matches(selector) && !target.closest(selector)) {
        // when scoped to a hovered/focused element, keep only its subtree
      }
      const props = new Set();
      try {
        for (const kf of eff.getKeyframes()) {
          for (const k of Object.keys(kf)) {
            if (['offset', 'composite', 'computedOffset', 'easing'].includes(k)) continue;
            props.add(k.replace(/([A-Z])/g, '-$1').toLowerCase());
          }
        }
      } catch { /* ignore */ }
      const ctor = anim.constructor ? anim.constructor.name : '';
      const isTransition = ctor === 'CSSTransition' || !!anim.transitionProperty;
      const rect = target && typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null;
      return {
        trigger,
        selector: cssPath(target),
        tag: target && target.tagName ? target.tagName.toLowerCase() : '',
        type: isTransition ? 'transition' : 'animation',
        name: anim.animationName || anim.transitionProperty || ctor || '',
        duration: typeof t.duration === 'number' ? t.duration : 0,
        delay: t.delay || 0,
        easing: t.easing || 'linear',
        iterations: t.iterations === Infinity ? 'Infinity' : t.iterations,
        properties: [...props],
        top: rect ? Math.round(rect.top + window.scrollY) : null,
        height: rect ? Math.round(rect.height) : null,
      };
    } catch { return null; }
  };
  let anims = [];
  try { anims = document.getAnimations(); } catch { anims = []; }
  if (selector) {
    anims = anims.filter(a => {
      const tgt = a.effect && a.effect.target;
      if (!tgt || !tgt.matches) return false;
      try { return tgt.matches(selector) || (tgt.closest && tgt.closest(selector)); } catch { return false; }
    });
  }
  return anims.map(serialize).filter(Boolean).slice(0, 60);
};

async function readRuntimeAnimations(page, trigger, selector) {
  return page.evaluate(READ_ANIMATIONS, { trigger, selector }).catch(() => []);
}

// Runtime motion capture: read document.getAnimations() at load, during the
// shared scroll pass (observations passed in via scrollObservations), and
// after hovering/focusing a sample of interactive elements. Returns raw
// observations consumed by src/extractors/motion-runtime.js. Defensive: every
// step is best-effort and any failure yields fewer observations, not a throw.
async function captureRuntimeMotion(page, { scrollObservations = [] } = {}) {
  const obs = [];
  const push = (arr) => { if (Array.isArray(arr)) obs.push(...arr); };

  // 1) Load — entrance + infinite animations still running.
  push(await readRuntimeAnimations(page, 'load'));

  // 2) Scroll — collected during the shared scroll pass in crawlPage.
  push(scrollObservations);

  // 3) Hover + focus — interaction transitions on a sample of controls.
  let samples = [];
  try {
    samples = await page.evaluate(() => {
      const out = [];
      const pick = (sel, n) => Array.from(document.querySelectorAll(sel)).slice(0, n)
        .forEach((el, i) => out.push(`${sel}:nth-of-type(${i + 1})`));
      pick('button', 5);
      pick('a[href]', 5);
      return out;
    });
  } catch { /* ignore */ }
  for (const sel of (samples || []).slice(0, 10)) {
    try {
      await page.hover(sel, { timeout: 500 });
      await page.waitForTimeout(90);
      push(await readRuntimeAnimations(page, 'hover', sel));
    } catch { /* ignore */ }
    try {
      await page.focus(sel, { timeout: 500 });
      await page.waitForTimeout(70);
      push(await readRuntimeAnimations(page, 'focus', sel));
    } catch { /* ignore */ }
  }

  return { observations: obs.slice(0, 200) };
}

// Top-level and self-contained (no module-scope references) because
// Playwright serializes this function's source to run it in the page.
export function collectPageData({ maxElements, ignoreSelectors, scopeSelector }) {
    // Remove ignored elements before extraction
    if (ignoreSelectors && ignoreSelectors.length > 0) {
      for (const sel of ignoreSelectors) {
        try {
          for (const el of document.querySelectorAll(sel)) {
            el.remove();
          }
        } catch { /* invalid selector */ }
      }
    }

    const results = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      computedStyles: [],
      cssVariables: {},
      mediaQueries: [],
      keyframes: [],
      crossOriginSheets: [],
      backgroundMedia: [],
    };

    // Non-rendering / non-visual tags: never useful as design evidence and
    // otherwise pollute computedStyles with head/script/svg-internal noise.
    const SKIP_COLLECT_TAGS = new Set([
      'SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT',
      'SOURCE', 'TRACK', 'TITLE', 'BASE', 'HEAD',
    ]);

    // Collect elements including shadow DOM contents. `budget` is one object
    // shared across every call in the tree (including recursive shadow-root
    // descents and multiple scopeRoots) — a per-call local counter would
    // reset on each shadow-root recursion, letting an attacker page with many
    // shadow hosts (each padded with skip-exempt junk) multiply total scan
    // work by the number of shadow hosts instead of capping it once overall.
    function collectElements(root, collected, budget) {
      // Skipped elements don't grow `collected`, so a naive
      // `collected.length >= maxElements` check alone lets an attacker page
      // with millions of budget-exempt elements (script tags, a huge inline
      // SVG subtree) make this scan unbounded. Track total visits too, and
      // cap them at a fixed multiple of maxElements.
      for (const el of root.querySelectorAll('*')) {
        if (collected.length >= maxElements || ++budget.visited > maxElements * 10) break;
        // Skip (don't push, don't count against the budget): anything inside
        // <head>, non-rendering tags, and SVG descendants (but keep the <svg>
        // root itself — ownerSVGElement is only set on elements *inside* one).
        if (el.closest('head') || SKIP_COLLECT_TAGS.has(el.tagName) || el.ownerSVGElement) continue;
        collected.push(el);
        if (el.shadowRoot) {
          collectElements(el.shadowRoot, collected, budget);
        }
      }
      return collected;
    }

    // If --selector was provided, scope element collection to the matching
    // subtrees only. Falls back to the full document if the selector is
    // invalid or returns no matches.
    let scopeRoots = [document];
    if (scopeSelector) {
      try {
        const matches = Array.from(document.querySelectorAll(scopeSelector));
        if (matches.length > 0) scopeRoots = matches;
      } catch { /* invalid selector → use document */ }
    }
    const elements = [];
    const scanBudget = { visited: 0 };
    for (const root of scopeRoots) {
      if (root !== document && root.nodeType === 1) elements.push(root);
      collectElements(root, elements, scanBudget);
      if (elements.length >= maxElements) break;
    }

    // Build a lightweight index: stylesheet URL + their top selectors.
    // Used to attribute each element's primary source stylesheet.
    const sheetIndex = [];
    try {
      for (const sheet of document.styleSheets) {
        const entry = { url: sheet.href || '', mediaText: sheet.media ? sheet.media.mediaText : '', selectors: [] };
        try {
          let cap = 0;
          for (const rule of sheet.cssRules) {
            if (cap >= 200) break;
            if (rule && rule.selectorText) {
              entry.selectors.push(rule.selectorText);
              cap++;
            }
          }
        } catch { /* cross-origin */ }
        if (entry.url || entry.selectors.length > 0) sheetIndex.push(entry);
      }
    } catch { /* no access */ }

    function findSourceFor(el) {
      // Try to find the first stylesheet that has a selector matching this element.
      for (const sheet of sheetIndex) {
        for (const sel of sheet.selectors) {
          try {
            // selectorText can contain multiple comma-separated selectors
            if (el.matches(sel)) {
              return { url: sheet.url, mediaText: sheet.mediaText };
            }
          } catch { /* invalid or unsupported selector */ }
        }
      }
      return null;
    }

    function readPseudo(el, which) {
      try {
        const ps = getComputedStyle(el, which);
        const content = ps.getPropertyValue('content');
        if (!content || content === 'none' || content === 'normal') return null;
        return {
          content,
          display: ps.display,
          position: ps.position,
          top: ps.top,
          left: ps.left,
          right: ps.right,
          bottom: ps.bottom,
          width: ps.width,
          height: ps.height,
          background: ps.background,
          color: ps.color,
          border: ps.border,
          transform: ps.transform,
          mask: ps.mask || ps.getPropertyValue('-webkit-mask') || '',
          clipPath: ps.clipPath || ps.getPropertyValue('-webkit-clip-path') || '',
        };
      } catch { return null; }
    }

    let sourceAttrBudget = 500;
    // Range measurement is the expensive part of this loop — cap it.
    let lineWidthBudget = 120;
    const PROSE_TAGS = new Set(['p', 'li', 'blockquote', 'dd']);

    // First url(...) in a computed backgroundImage value, e.g. from
    // 'url("hero.jpg")' or a multi-layer 'url(a.png), url(b.png)'.
    function firstBackgroundUrl(backgroundImage) {
      const m = backgroundImage && backgroundImage.match(/url\((['"]?)([^'")]+)\1\)/);
      return m ? m[2] : '';
    }

    for (const el of elements) {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const classList = Array.from(el.classList).join(' ');
      const role = el.getAttribute('role') || '';
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;

      const before = readPseudo(el, '::before');
      const after = readPseudo(el, '::after');
      const pseudo = (before || after) ? { before, after } : null;

      let sources = null;
      if (sourceAttrBudget > 0) {
        const s = findSourceFor(el);
        if (s) sources = [s];
        sourceAttrBudget--;
      }

      // Rendered line width for prose. A paragraph's box is as wide as its
      // container; the text inside it usually is not, so measuring the box
      // reports a line length nobody is actually reading. A Range over the
      // element's own text gives the real line boxes.
      let lineWidth = null;
      if (lineWidthBudget > 0 && PROSE_TAGS.has(tag)) {
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = range.getClientRects();
          let widest = 0;
          for (const r of rects) {
            if (r.height > 0 && r.width > widest) widest = r.width;
          }
          if (widest > 0) lineWidth = Math.round(widest);
          lineWidthBudget--;
        } catch { /* detached or unmeasurable */ }
      }

      // hasText: at least one direct text-node child with visible characters —
      // lets downstream extractors filter decorative spans/divs out of WCAG
      // contrast accounting.
      let hasText = false;
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && node.textContent && node.textContent.trim()) { hasText = true; break; }
      }

      results.computedStyles.push({
        tag, classList, role, area, hasText, lineWidth,
        // Box geometry — measure (chars per line), container ladders and
        // section rhythm all need the rendered width, not just the area.
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top + window.scrollY),
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        borderColor: cs.borderColor,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        marginTop: cs.marginTop,
        marginRight: cs.marginRight,
        marginBottom: cs.marginBottom,
        marginLeft: cs.marginLeft,
        gap: cs.gap,
        borderRadius: cs.borderRadius,
        borderWidth: cs.borderWidth,
        borderStyle: cs.borderStyle,
        boxShadow: cs.boxShadow,
        textShadow: cs.textShadow,
        zIndex: cs.zIndex,
        transition: cs.transition,
        animation: cs.animation,
        animationTimeline: cs.animationTimeline || cs.getPropertyValue('animation-timeline') || '',
        animationRangeStart: cs.getPropertyValue('animation-range-start') || '',
        animationRangeEnd: cs.getPropertyValue('animation-range-end') || '',
        viewTimelineName: cs.getPropertyValue('view-timeline-name') || '',
        scrollTimelineName: cs.getPropertyValue('scroll-timeline-name') || '',
        display: cs.display,
        position: cs.position,
        flexDirection: cs.flexDirection,
        flexWrap: cs.flexWrap,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        gridTemplateColumns: cs.gridTemplateColumns,
        gridTemplateRows: cs.gridTemplateRows,
        maxWidth: cs.maxWidth,
        fontVariationSettings: cs.fontVariationSettings || cs.getPropertyValue('font-variation-settings') || 'normal',
        fontFeatureSettings: cs.fontFeatureSettings || cs.getPropertyValue('font-feature-settings') || 'normal',
        textWrap: cs.textWrap || cs.getPropertyValue('text-wrap') || '',
        textDecorationStyle: cs.textDecorationStyle || '',
        textDecorationThickness: cs.textDecorationThickness || '',
        textUnderlineOffset: cs.textUnderlineOffset || '',
        pseudo,
        sources,
      });

      // Background media (v11): CSS background-images and video posters carry
      // design-relevant imagery that computedStyles alone doesn't surface.
      if (results.backgroundMedia.length < 500) {
        const bgUrl = cs.backgroundImage.includes('url(') ? firstBackgroundUrl(cs.backgroundImage) : '';
        if (bgUrl && !bgUrl.startsWith('data:image/svg') && rect.width >= 5 && rect.height >= 5) {
          results.backgroundMedia.push({
            kind: 'css-background',
            tag,
            classList: classList.slice(0, 500),
            src: bgUrl.slice(0, 500),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top + window.scrollY),
            left: Math.round(rect.left + window.scrollX),
            opacity: Number(cs.opacity),
            backgroundSize: cs.backgroundSize,
          });
        }
        if (tag === 'video') {
          const poster = el.getAttribute('poster');
          if (poster && results.backgroundMedia.length < 500) {
            results.backgroundMedia.push({
              kind: 'video-poster',
              tag: 'video',
              src: poster.slice(0, 500),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top + window.scrollY),
              left: Math.round(rect.left + window.scrollX),
              opacity: Number(cs.opacity),
            });
          }
        }
        // A sizeable canvas is rendered media too (WebGL heroes, charts). No
        // pixels are read; the record only says that a painted surface exists.
        if (tag === 'canvas' && rect.width * rect.height >= 10000 && results.backgroundMedia.length < 500) {
          results.backgroundMedia.push({
            kind: 'canvas',
            tag: 'canvas',
            classList: classList.slice(0, 500),
            src: '',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top + window.scrollY),
            left: Math.round(rect.left + window.scrollX),
            opacity: Number(cs.opacity),
          });
        }
      }
    }

    // CSS custom properties
    const rootStyles = getComputedStyle(document.documentElement);
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText === ':root' || rule.selectorText === ':host') {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--')) {
                  results.cssVariables[prop] = rule.style.getPropertyValue(prop).trim();
                }
              }
            }
          }
        } catch { if (sheet.href) results.crossOriginSheets.push(sheet.href); }
      }
    } catch { /* no access */ }

    for (let i = 0; i < rootStyles.length; i++) {
      const prop = rootStyles[i];
      if (prop.startsWith('--') && !results.cssVariables[prop]) {
        results.cssVariables[prop] = rootStyles.getPropertyValue(prop).trim();
      }
    }

    // Media queries
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSMediaRule) {
              results.mediaQueries.push(rule.conditionText || rule.media.mediaText);
            }
          }
        } catch { /* cross-origin — already tracked */ }
      }
    } catch { /* no access */ }

    // Keyframes
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSKeyframesRule) {
              const steps = [];
              for (const kf of rule.cssRules) {
                steps.push({ offset: kf.keyText, style: kf.style.cssText });
              }
              results.keyframes.push({ name: rule.name, steps });
            }
          }
        } catch { /* cross-origin — already tracked */ }
      }
    } catch { /* no access */ }

    // Container queries (@container rules), env() usage, and modern colors
    results.containerQueries = [];
    results.envUsage = [];
    results.modernColors = [];
    // Fluid/responsive declarations. Computed styles resolve clamp() and vw
    // units down to a single px value at the capture viewport, so the only
    // place a site's *fluid* intent survives is the authored declaration.
    results.fluidValues = [];
    const FLUID_PROPS = ['font-size', 'line-height', 'letter-spacing', 'padding', 'padding-top', 'padding-bottom', 'padding-inline', 'padding-block', 'gap', 'row-gap', 'column-gap', 'width', 'max-width', 'margin-block', 'border-radius'];
    const FLUID_VALUE_RE = /clamp\(|min\(|max\(|calc\(|[\d.]+\s*v(?:w|h|min|max|i|b)\b/i;
    const MODERN_COLOR_RE = /(oklch\([^)]+\)|oklab\([^)]+\)|color-mix\([^)]+\)|light-dark\([^)]+\)|color\(\s*display-p3[^)]+\)|color\(\s*rec2020[^)]+\))/gi;
    function walkRulesForContainersAndEnv(rules) {
      for (const rule of rules) {
        try {
          // Scan declarations for modern color functions
          if (rule.style && rule.cssText) {
            const css = rule.cssText;
            for (const m of css.matchAll(MODERN_COLOR_RE)) {
              const raw = m[1];
              let type = 'other';
              if (/^oklch/i.test(raw)) type = 'oklch';
              else if (/^oklab/i.test(raw)) type = 'oklab';
              else if (/^color-mix/i.test(raw)) type = 'color-mix';
              else if (/^light-dark/i.test(raw)) type = 'light-dark';
              else if (/display-p3/i.test(raw)) type = 'display-p3';
              else if (/rec2020/i.test(raw)) type = 'rec2020';
              // Try to infer property
              let property = '';
              for (let i = 0; i < rule.style.length; i++) {
                const p = rule.style[i];
                if ((rule.style.getPropertyValue(p) || '').includes(raw)) { property = p; break; }
              }
              results.modernColors.push({ raw, type, property, selector: rule.selectorText || '' });
            }
          }
          // Container query
          if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
            const inner = [];
            try {
              for (const inr of rule.cssRules) {
                if (inr.selectorText) inner.push(inr.selectorText);
              }
            } catch {}
            results.containerQueries.push({
              condition: rule.conditionText || rule.containerQuery || '',
              selectorText: inner.join(', '),
              declarationCount: inner.length,
            });
          } else if (rule.cssText && rule.cssText.startsWith('@container')) {
            results.containerQueries.push({
              condition: rule.conditionText || '',
              selectorText: '',
              declarationCount: 0,
            });
          }
          // Fluid declarations (clamp/vw/min/max) — capped so a huge
          // stylesheet can't blow up the payload.
          if (rule.style && results.fluidValues.length < 400) {
            for (const prop of FLUID_PROPS) {
              const v = rule.style.getPropertyValue(prop);
              if (v && FLUID_VALUE_RE.test(v)) {
                results.fluidValues.push({ property: prop, value: v.trim(), selector: (rule.selectorText || '').slice(0, 120) });
              }
            }
          }
          // env() scan on declaration text
          if (rule.style) {
            const css = rule.cssText || '';
            const envMatches = css.match(/env\(\s*(safe-area-inset-[a-z]+|viewport-[a-z-]+|[a-z-]+)/gi);
            if (envMatches) {
              for (const m of envMatches) {
                results.envUsage.push(m.replace(/^env\(\s*/, '').trim());
              }
            }
          }
          // Recurse into grouping rules (media, supports, container)
          if (rule.cssRules) {
            walkRulesForContainersAndEnv(rule.cssRules);
          }
        } catch { /* ignore per-rule errors */ }
      }
    }
    try {
      for (const sheet of document.styleSheets) {
        try {
          walkRulesForContainersAndEnv(sheet.cssRules);
        } catch { /* cross-origin — already tracked */ }
      }
    } catch { /* no access */ }
    // dedupe envUsage
    results.envUsage = [...new Set(results.envUsage)];

    // Component clusters (v7): per-element features for similarity-based grouping.
    function colorToChannels(str) {
      if (!str) return [0, 0, 0, 0];
      const m = String(str).match(/rgba?\(([^)]+)\)/i);
      if (!m) return [0, 0, 0, 0];
      const parts = m[1].split(',').map(s => parseFloat(s));
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] === undefined ? 1 : parts[3]];
    }
    function structuralHashOf(el) {
      const parts = [el.tagName.toLowerCase()];
      for (const c of el.children) {
        parts.push(c.tagName.toLowerCase());
      }
      return parts.slice(0, 6).join('>');
    }
    const candidateSelector = 'button, a[role="button"], .btn, [class*="button"], input[type="text"], input[type="email"], input[type="search"], textarea, [class*="card"]';
    results.componentCandidates = [];
    const seenCandidates = new Set();
    for (const el of document.querySelectorAll(candidateSelector)) {
      if (results.componentCandidates.length >= 300) break;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (seenCandidates.has(el)) continue;
      seenCandidates.add(el);
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      let kind = 'other';
      const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (tag === 'button' || el.getAttribute('role') === 'button' || /\bbtn\b|button/.test(cls)) kind = 'button';
      else if (tag === 'input' || tag === 'textarea') kind = 'input';
      else if (tag === 'a') kind = 'link';
      else if (/card/.test(cls)) kind = 'card';
      const bg = colorToChannels(cs.backgroundColor);
      const fg = colorToChannels(cs.color);
      const styleVector = [
        parseFloat(cs.paddingTop) || 0,
        parseFloat(cs.paddingRight) || 0,
        parseFloat(cs.paddingBottom) || 0,
        parseFloat(cs.paddingLeft) || 0,
        bg[0], bg[1], bg[2], bg[3] * 255,
        fg[0], fg[1], fg[2], fg[3] * 255,
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderWidth) || 0,
        parseFloat(cs.fontSize) || 0,
        parseFloat(cs.fontWeight) || 0,
      ];
      const text = ((el.innerText || el.textContent || '') + '').trim().slice(0, 160);
      const slots = Array.from(el.children).slice(0, 8).map(c => {
        const tagName = c.tagName.toLowerCase();
        let role = 'content';
        if (tagName === 'svg' || tagName === 'img' || c.querySelector?.('svg,img')) role = 'icon';
        else if (/badge|pill|tag|chip/i.test(c.className || '')) role = 'badge';
        else if (/h[1-6]/.test(tagName) || /title|heading/i.test(c.className || '')) role = 'heading';
        else if (/description|subtitle|text|body/i.test(c.className || '')) role = 'text';
        return { tag: tagName, role, text: ((c.innerText || c.textContent || '') + '').trim().slice(0, 80) };
      });
      results.componentCandidates.push({
        kind,
        structuralHash: structuralHashOf(el),
        styleVector,
        text,
        slots,
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        variantHint: (cls.match(/\b(primary|secondary|tertiary|ghost|outline|solid|destructive|danger|success|warning|link|subtle)\b/) || [])[1] || '',
        sizeHint: (cls.match(/\b(xs|sm|md|lg|xl|small|medium|large)\b/) || [])[1] || '',
        css: {
          background: cs.backgroundColor,
          color: cs.color,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
          borderRadius: cs.borderTopLeftRadius,
          border: `${cs.borderWidth} ${cs.borderStyle} ${cs.borderColor}`,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
        },
      });
    }

    // Semantic regions (v7): landmark + heading + bounds data for classifier.
    const BUTTON_SELECTOR = 'button, a[role="button"], .btn, [class*="button"]';
    const CARD_SELECTOR = 'article, li, [class*="card"], [class*="item"]';
    results.sections = Array.from(document.querySelectorAll(
      'header, nav, main, section, footer, aside, [role="banner"], [role="contentinfo"], [role="complementary"], [role="navigation"]'
    )).slice(0, 100).map(el => {
      const r = el.getBoundingClientRect();
      const position = getComputedStyle(el).position;
      const y = position === 'fixed' ? Math.round(r.top) : Math.round(r.top + window.scrollY);
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        className: typeof el.className === 'string' ? el.className : '',
        id: el.id || '',
        position,
        text: (el.innerText || '').slice(0, 2000),
        headings: Array.from(el.querySelectorAll('h1,h2,h3')).slice(0, 5).map(h => h.innerText || ''),
        buttonCount: el.querySelectorAll(BUTTON_SELECTOR).length,
        cardCount: el.querySelectorAll(CARD_SELECTOR).length,
        bounds: { x: r.x, y, w: r.width, h: r.height },
      };
    });

    // Section blueprint: full-width bands found by geometry, not by landmark
    // tags. Walk down from body: an element with two or more full-width tall
    // children that fill most of it is a container (descend); one such child
    // of the same height is a wrapper (descend, remember the outer element);
    // anything else is a band. The outermost element of a wrapper chain is
    // the band's box; the innermost is where columns are measured.
    const vw = window.innerWidth;
    // Page height: the larger of the document's own scrollHeight and the
    // tallest scrollHeight among the first 2500 full-width elements in
    // document order, not counting <head> and its descendants or
    // non-rendering tags (script/style/link/meta/etc.). Probed live: on N26
    // the real scroll container sits at counted index ~293 (past a large
    // <head> plus srcset <source> boilerplate); on Emma Lewisham, a Shopify
    // theme with several hidden app widgets (cart drawer, search modal,
    // consent widget) ahead of it in document order, the real content
    // wrapper sits past index 1200. 300, the figure this was originally
    // sized to, does not reach either live site; 2500 covers both with a
    // wide margin and is still a single cheap pass (no style computation,
    // just tag/rect checks). A page whose scrolling happens in an inner
    // container (or a transformed scroll library, e.g. Locomotive Scroll)
    // leaves the document itself only one viewport tall; this catches the
    // container instead. Duplicated verbatim in scrollThroughPage, which
    // cannot reach into this serialized function.
    {
      const docHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      const PAGE_HEIGHT_SKIP_TAG = /^(script|style|link|template|noscript|source|track|title|base|meta)$/;
      let wideScrollHeight = 0;
      let counted = 0;
      for (const el of document.querySelectorAll('*')) {
        if (el.closest('head') || PAGE_HEIGHT_SKIP_TAG.test(el.tagName.toLowerCase()) || el.ownerSVGElement) continue;
        if (counted++ >= 2500) break;
        if (el.getBoundingClientRect().width < vw * 0.9) continue;
        if (el.scrollHeight > wideScrollHeight) wideScrollHeight = el.scrollHeight;
      }
      results.pageHeight = Math.max(docHeight, wideScrollHeight);
    }
    const BAND_CAP = 40;
    const OVERSIZED_LEAF_SHARE = 0.8;
    const MIN_WIDTH_SHARE = 0.9;
    const RELAXED_WIDTH_SHARES = [0.6, 0.4];
    const PASS_THROUGH_DEPTH = 4;
    const SKIP_TAG = /^(script|style|link|template|noscript|svg|img|video|canvas|iframe|picture|source)$/;
    const isLandmarkBand = (el) => /^(header|nav|footer)$/.test(el.tagName.toLowerCase())
      || /^(banner|navigation|contentinfo)$/.test(el.getAttribute('role') || '');
    // refWidth is the width a candidate's own width is measured against: the
    // viewport at the top level (checking body's children), and the width of
    // the element whose children are being tested at every level below that
    // (see the `walk`/`bandKids` call sites). A theme that nests a full-width
    // wrapper around a site-width row (Avada: fusion-fullwidth 100% vw >
    // fusion-builder-row ~86-98% of its fullwidth parent) needs the row
    // measured against ITS parent, not the viewport, or the fullwidth simply
    // absorbs the row and everything under it into one leaf.
    const isBandBox = (el, minWidthShare, refWidth) => {
      if (el.nodeType !== 1 || SKIP_TAG.test(el.tagName.toLowerCase())) return false;
      const r = el.getBoundingClientRect();
      if (r.width < refWidth * minWidthShare) return false;
      return r.height >= (isLandmarkBand(el) ? 40 : 120);
    };
    // A degenerate-box element paints nothing usable of its own but its
    // children still lay out as real content, either `display: contents`
    // (both axes 0 — Monzo's `HideUntilExperimentResolved` wrapper inside
    // <main>, Hyperliquid's Framer motion wrapper) or a normal block whose
    // only children are taken out of flow (position: fixed/absolute), which
    // collapses it to zero height while it keeps its full width (Emma
    // Lewisham: an empty `<main>` wrapping a position:fixed Locomotive Scroll
    // container — probed live, overflow: visible there). Either way it hides
    // a whole content tree behind one invisible wrapper, collapsing real
    // sections into a single oversized leaf or, walked from the top, into no
    // bands at all. See through it so its real children are visible to the
    // walk, bounded so a page with nested pass-through wrappers can't make
    // this unbounded.
    //
    // A single-axis-zero box additionally requires overflow: visible on
    // both axes. `display: contents` (both axes 0) generates no box at all,
    // so overflow doesn't apply and it is always seen through. But a
    // single-axis-zero box with overflow: hidden is the CSS idiom for a
    // deliberately collapsed panel — a closed accordion, a modal mid-animate
    // shut — whose children are real but meant to stay hidden; that one is
    // not flattened.
    const isPassThrough = (el) => {
      if (el.nodeType !== 1 || SKIP_TAG.test(el.tagName.toLowerCase())) return false;
      if (el.children.length === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return true;
      if (r.width === 0 || r.height === 0) {
        const cs = getComputedStyle(el);
        return cs.overflowX === 'visible' && cs.overflowY === 'visible';
      }
      return false;
    };
    const bandKids = (el, minWidthShare, passDepth, refWidth) => {
      const out = [];
      for (const child of el.children) {
        if (isBandBox(child, minWidthShare, refWidth)) { out.push(child); continue; }
        if (passDepth > 0 && isPassThrough(child)) {
          out.push(...bandKids(child, minWidthShare, passDepth - 1, refWidth));
        }
      }
      return out;
    };
    // A wrapper with exactly one real (non-skip) child that fills nearly all
    // of its height is descended into regardless of width — the width test
    // above is for deciding whether SIBLINGS are separate sections; a lone
    // child that IS the wrapper's whole content (an Avada site-width row
    // inside its full-width fullwidth parent, e.g.) is not a sibling
    // comparison at all.
    const soleRealChild = (el) => {
      let only = null;
      for (const child of el.children) {
        if (child.nodeType !== 1 || SKIP_TAG.test(child.tagName.toLowerCase())) continue;
        if (only) return null;
        only = child;
      }
      return only;
    };
    // The same-height-regardless-of-width descent is for seeing through
    // purely structural wrappers (fusion-fullwidth, a plain centered div)
    // that have no identity of their own. A landmark or a <section> IS
    // already a real, named piece of the page — its own bounds, background,
    // and role are meaningful — so peering inside it for a lone child to
    // bypass into must not happen: on real sites this repeatedly ate a
    // <footer>/<header>/hero <section> (whose real content sits in a
    // centered inner wrapper) and replaced it with that wrapper's OWN
    // children once THEY passed the strict width test one level down,
    // discarding the landmark's bounds entirely (Apple's footer became
    // seven nav/list bands; a Shopify header became a mega-menu's panels;
    // Wise's hero section became one of its inner rows). Width alone can't
    // tell fusion-fullwidth and <footer> apart — both render at ~100% of
    // their parent — so this is a tag check, not a geometry one.
    const blocksWrapperDescent = (el) => isLandmarkBand(el) || el.tagName.toLowerCase() === 'section';
    const leaves = [];
    let bandsCapped = false;
    const walk = (el, chain, depth, minWidthShare, refWidth) => {
      if (leaves.length >= BAND_CAP) { bandsCapped = true; return; }
      if (depth > 14) return;
      const share = minWidthShare || MIN_WIDTH_SHARE;
      const kids = bandKids(el, share, PASS_THROUGH_DEPTH, refWidth);
      const h = el.getBoundingClientRect().height || 1;
      const kidsH = kids.reduce((n, k) => n + k.getBoundingClientRect().height, 0);
      // Once chain[0] (the outer boundary already established for this
      // band) is a landmark or section, the multi-kid branch below must
      // not reset chain to a fresh [k] — that's the actual mechanism that
      // ate real sites' landmarks: single-kid/bypass hops correctly extend
      // chain (chain[0] never changes), but a plain div two or three levels
      // inside a <section> can still hold two ordinary width-qualifying
      // siblings, and resetting there discards the section's own bounds
      // for theirs (Wise: section > div > mw-container > mw-container >
      // mw-container, whose own two children — a 268px-tall row and an
      // 871px-tall block — passed the strict width test and became their
      // own bands, one of them wrongly inheriting the hero role).
      // Single-kid and the soleRealChild bypass never hit this because
      // they already extend chain rather than reset it.
      const insideLandmarkChain = chain.length > 0 && blocksWrapperDescent(chain[0]);
      if (kids.length >= 2 && kidsH >= h * 0.6 && !insideLandmarkChain) {
        for (const k of kids) walk(k, [k], depth + 1, share, k.getBoundingClientRect().width);
        return;
      }
      if (kids.length === 1 && kids[0].getBoundingClientRect().height >= h * 0.9) {
        const k = kids[0];
        walk(k, chain.length ? chain.concat(k) : [k], depth + 1, share, k.getBoundingClientRect().width);
        return;
      }
      if (kids.length === 0 && !blocksWrapperDescent(el)) {
        const only = soleRealChild(el);
        if (only && only.getBoundingClientRect().height >= h * 0.9) {
          walk(only, chain.length ? chain.concat(only) : [only], depth + 1, share, only.getBoundingClientRect().width);
          return;
        }
      }
      if (!chain.length) return;
      // A leaf that swallows almost the whole page is usually not one real
      // band: either a content wrapper whose real sections sit under the
      // width threshold (a centered max-width container), or one whose
      // sections are hidden behind a zero-box wrapper the default share
      // didn't see through. Retry at a relaxed width share before accepting
      // it as one giant band. The relaxed share is for finding THIS level's
      // children only — once found, each one walks its own subtree at the
      // normal MIN_WIDTH_SHARE, or a genuinely narrow grandchild two levels
      // down would pass a threshold relaxed once but inherited forever
      // (parent-relative widths mean that compounds: a share carried three
      // levels deep is an effective floor of 0.6^3 ≈ 22% of the viewport).
      const leafHeight = el.getBoundingClientRect().height;
      // Same reasoning as the multi-kid branch above: once chain[0] is a
      // landmark, this retry must not run at all — resetting chain to a
      // relaxed child would discard the landmark exactly as before (an
      // oversized element inside a landmark — a short section whose real
      // content is two centered, sub-90%-width blocks — otherwise falls
      // through to this retry and loses the landmark to its own relaxed
      // children), and extending chain instead (rather than skipping the
      // retry) still duplicates the landmark once per relaxed child found —
      // verified empirically against a two-block fixture, which produced
      // two identical section bands before this was changed to skip
      // outright.
      if (share === MIN_WIDTH_SHARE && results.pageHeight > 0 && leafHeight > results.pageHeight * OVERSIZED_LEAF_SHARE && !insideLandmarkChain) {
        for (const relaxedShare of RELAXED_WIDTH_SHARES) {
          const relaxedKids = bandKids(el, relaxedShare, PASS_THROUGH_DEPTH, refWidth);
          if (relaxedKids.length > 0) {
            for (const k of relaxedKids) walk(k, [k], depth + 1, MIN_WIDTH_SHARE, k.getBoundingClientRect().width);
            return;
          }
        }
      }
      leaves.push(chain);
    };
    if (document.body) walk(document.body, [], 0, MIN_WIDTH_SHARE, vw);

    const toHex = (color) => {
      const m = (color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
      return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
    };
    const isPlaceholderSrc = (s) => !s || /^data:/i.test(s) || /^about:blank$/i.test(s);
    const absUrl = (u) => { try { return new URL(u, location.href).href; } catch { return u || ''; } };
    // A resolved candidate whose scheme is not http(s) is not a usable image
    // source: javascript:/blob: URLs some sites park in a lazy-load
    // attribute, a data: URI outside the placeholder check, and the raw
    // input absUrl falls back to when new URL() throws.
    const isHttpUrl = (u) => /^https?:/i.test(u);
    // First URL in a srcset ("a.jpg 1x, b.jpg 2x").
    function firstSrcsetUrl(srcset) {
      if (!srcset) return '';
      return srcset.split(',')[0].trim().split(/\s+/)[0] || '';
    }
    // The displayed source unless it is a placeholder (lazysizes and its
    // relatives park a transparent data: SVG in src/currentSrc and keep the
    // real URL in a data- attribute until their script swaps it in, which a
    // headless capture cannot rely on). 1x sources before srcsets.
    const realImageSrc = (img) => {
      const cur = img.currentSrc || '';
      if (!isPlaceholderSrc(cur) && isHttpUrl(cur)) return cur;
      const attr = img.getAttribute('src') || '';
      if (!isPlaceholderSrc(attr)) {
        const abs = absUrl(attr);
        if (isHttpUrl(abs)) return abs;
      }
      const picture = img.closest('picture');
      const source = picture && picture.querySelector('source[srcset]');
      const candidates = [
        img.getAttribute('data-orig-src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
        firstSrcsetUrl(img.getAttribute('data-srcset')), firstSrcsetUrl(img.getAttribute('srcset')),
        source ? firstSrcsetUrl(source.getAttribute('srcset')) : '',
      ];
      for (const c of candidates) {
        if (!c || isPlaceholderSrc(c)) continue;
        const abs = absUrl(c);
        if (isHttpUrl(abs)) return abs;
      }
      return '';
    };
    const isLazyUnresolved = (img) => isPlaceholderSrc(img.currentSrc || img.getAttribute('src') || '')
      && ['data-orig-src', 'data-src', 'data-lazy-src', 'data-srcset'].some((a) => img.hasAttribute(a));
    const bgOf = (el) => {
      const cs = getComputedStyle(el);
      const color = toHex(cs.backgroundColor);
      const url = (cs.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
      let imageUrl = url && isHttpUrl(url[1]) ? url[1].slice(0, 500) : null;
      if (!imageUrl) {
        const lazy = el.getAttribute('data-bg') || el.getAttribute('data-background-image') || '';
        if (lazy && !isPlaceholderSrc(lazy)) {
          const abs = absUrl(lazy);
          if (isHttpUrl(abs)) imageUrl = abs.slice(0, 500);
        }
      }
      return { color, imageUrl };
    };
    const rectOf = (el) => el.getBoundingClientRect();
    const areaOf = (el) => { const r = rectOf(el); return r.width * r.height; };
    const docBox = (el, position) => {
      const r = rectOf(el);
      const y = position === 'fixed' ? Math.round(r.top) : Math.round(r.top + window.scrollY);
      return { x: Math.round(r.left), y, w: Math.round(r.width), h: Math.round(r.height) };
    };

    results.bands = leaves.map((chain) => {
      const outer = chain[0];
      const leaf = chain[chain.length - 1];
      const position = getComputedStyle(outer).position;
      const bounds = docBox(outer, position);
      const area = Math.max(1, bounds.w * bounds.h);
      const descendants = Array.from(outer.querySelectorAll('*')).slice(0, 600);

      // Background: the wrapper chain first, then any descendant painting ≥80% of the band.
      let background = { color: null, imageUrl: null };
      for (const el of chain) { const bg = bgOf(el); if (bg.color || bg.imageUrl) { background = bg; break; } }
      if (!background.color && !background.imageUrl) {
        for (const el of descendants) {
          if (areaOf(el) < area * 0.8) continue;
          const bg = bgOf(el); if (bg.color || bg.imageUrl) { background = bg; break; }
        }
      }
      let inherited = false;
      if (!background.color && !background.imageUrl) {
        for (let el = outer.parentElement; el; el = el.parentElement) {
          const bg = bgOf(el);
          if (bg.color || bg.imageUrl) { background = { color: bg.color, imageUrl: bg.imageUrl }; inherited = true; break; }
        }
      }
      background.inherited = inherited;
      background.hasVideo = Array.from(outer.querySelectorAll('video')).some(v => areaOf(v) >= area * 0.5);

      // Columns: the widest row of two or more equal-width, side-by-side
      // children. Group by rounded top, not anchored on the first child —
      // anchoring on rects[0] misreads a grid whose first child is a
      // full-width heading (e.g. a "Services" title above a card grid) as a
      // single column, since nothing else shares the heading's own top.
      let columns = 1; let bestRowWidth = 0;
      for (const row of [leaf, ...descendants]) {
        const rects = Array.from(row.children).map(rectOf).filter(r => r.width >= 40 && r.height >= 40);
        if (rects.length < 2) continue;
        const groups = new Map();
        for (const r of rects) {
          const key = Math.round(r.top / 10);
          const group = groups.get(key);
          if (group) group.push(r); else groups.set(key, [r]);
        }
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          // Same-top is necessary but not sufficient — a stack of
          // position:absolute slides (a carousel) shares one top with every
          // other slide too, but they're the same column repeated, not
          // several columns side by side. Members must also be horizontally
          // disjoint: sort by left, keep a member only if it starts at or
          // after the last KEPT member's right edge (2px tolerance for
          // sub-pixel rounding); an overlapping member is dropped rather
          // than ending the scan, so unrelated overlaps elsewhere in the
          // group don't hide a real disjoint pair.
          const sorted = [...group].sort((a, b) => a.left - b.left);
          const disjoint = [];
          for (const r of sorted) {
            const prevRight = disjoint.length ? disjoint[disjoint.length - 1].right : -Infinity;
            if (r.left >= prevRight - 2) disjoint.push(r);
          }
          if (disjoint.length < 2) continue;
          const widths = disjoint.map(r => r.width);
          if (Math.min(...widths) < Math.max(...widths) * 0.9) continue;
          const total = widths.reduce((n, w) => n + w, 0);
          if (total > bestRowWidth) { bestRowWidth = total; columns = disjoint.length; }
        }
      }

      // Media: dominant kind by area among img/video/svg/canvas and background images.
      const kinds = { photo: 0, video: 0, svg: 0, canvas: 0, embed: 0 };
      const largest = { photo: null, video: null, svg: null, canvas: null, embed: null };
      let videoPoster = null;
      const consider = (kind, a, src) => {
        kinds[kind] += a;
        if (!largest[kind] || a > largest[kind].area) largest[kind] = { area: a, src: src || null };
      };
      for (const el of outer.querySelectorAll('img, video, svg, canvas, iframe, embed, object')) {
        const a = areaOf(el);
        if (a < 32 * 32) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === 'img') {
          const src = realImageSrc(el).slice(0, 500);
          consider(/\.svg(\?|$)/i.test(src) ? 'svg' : 'photo', a, src);
        } else if (tag === 'video') {
          const source = el.querySelector('source');
          const poster = el.getAttribute('poster');
          if (poster && !videoPoster) videoPoster = absUrl(poster).slice(0, 500);
          consider('video', a, (el.currentSrc || el.getAttribute('src') || (source && source.getAttribute('src')) || poster || '').slice(0, 500));
        } else if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
          const src = el.getAttribute('src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-src') || el.getAttribute('data') || '';
          consider('embed', a, isPlaceholderSrc(src) ? null : absUrl(src).slice(0, 500));
        } else {
          consider(tag, a, null);
        }
      }
      for (const el of [outer, ...descendants]) {
        const bg = bgOf(el);
        if (!bg.imageUrl) continue;
        const a = areaOf(el);
        if (a >= 100 * 100) consider('photo', a, bg.imageUrl);
      }
      const dominant = Object.keys(kinds).sort((p, q) => kinds[q] - kinds[p])[0];
      const totalMedia = kinds.photo + kinds.video + kinds.svg + kinds.canvas + kinds.embed;
      const kind = totalMedia < area * 0.05 ? 'none' : dominant;
      const media = {
        kind,
        share: kind === 'none' ? 0 : Math.round(Math.min(1, kinds[kind] / area) * 100) / 100,
        src: kind === 'none' ? null : (largest[kind] && largest[kind].src) || null,
      };
      if (kind === 'video') media.poster = videoPoster;

      // Largest heading by font size.
      let heading = null;
      for (const hEl of outer.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
        const size = parseFloat(getComputedStyle(hEl).fontSize) || 0;
        if (!heading || size > heading.fontSize) {
          heading = { level: Number(hEl.tagName[1]), fontSize: Math.round(size), text: (hEl.innerText || '').trim().slice(0, 120) };
        }
      }

      // Repeated structure: the largest group of sibling boxes (to depth 4)
      // with the same width and similar height. A services grid, a pricing
      // row, a testimonial carousel all show up here even when nothing is
      // called "card". Bounded by depth and by a visit budget.
      const repeatsOf = (root) => {
        let best = null;
        let visited = 0;
        const visit = (el, depth) => {
          if (depth > 4 || visited > 400) return;
          visited++;
          const kids = Array.from(el.children).filter((c) => c.nodeType === 1 && !SKIP_TAG.test(c.tagName.toLowerCase()));
          const boxes = kids.map((c) => ({ el: c, r: rectOf(c) })).filter((b) => b.r.width >= 100 && b.r.height >= 120);
          if (boxes.length >= 3) {
            const sorted = [...boxes].sort((p, q) => p.r.width - q.r.width);
            let i = 0;
            while (i < sorted.length) {
              let j = i;
              while (j + 1 < sorted.length && sorted[j + 1].r.width - sorted[i].r.width <= 4) j++;
              const group = sorted.slice(i, j + 1);
              if (group.length >= 3) {
                const hs = group.map((b) => b.r.height).sort((p, q) => p - q);
                const median = hs[Math.floor(hs.length / 2)];
                const members = group.filter((b) => Math.abs(b.r.height - median) <= median * 0.15)
                  .sort((p, q) => p.r.top - q.r.top || p.r.left - q.r.left);
                if (members.length >= 3 && (!best || members.length > best.count)) {
                  const top0 = members[0].r.top;
                  const sameTop = members.filter((b) => Math.abs(b.r.top - top0) <= 10).sort((p, q) => p.r.left - q.r.left);
                  const disjoint = [];
                  for (const b of sameTop) {
                    const prevRight = disjoint.length ? disjoint[disjoint.length - 1].r.right : -Infinity;
                    if (b.r.left >= prevRight - 2) disjoint.push(b);
                  }
                  best = {
                    count: members.length,
                    w: Math.round(members[0].r.width),
                    h: Math.round(median),
                    perRow: disjoint.length,
                    withImage: members.filter((b) => Array.from(b.el.querySelectorAll('img, video, svg')).some((m) => areaOf(m) >= 32 * 32)).length,
                    withButton: members.filter((b) => b.el.querySelector(BUTTON_SELECTOR)).length,
                  };
                }
              }
              i = j + 1;
            }
          }
          for (const c of kids) visit(c, depth + 1);
        };
        visit(root, 0);
        return best;
      };
      const repeats = repeatsOf(outer);
      if (repeats && repeats.perRow >= 2) columns = Math.max(columns, repeats.perRow);
      const selectorCards = outer.querySelectorAll(CARD_SELECTOR).length;

      const outerText = outer.innerText || '';
      const text = outerText.slice(0, 2000);
      return {
        tag: outer.tagName.toLowerCase(),
        role: outer.getAttribute('role') || '',
        className: (typeof outer.className === 'string' ? outer.className : '').slice(0, 300),
        id: outer.id || '',
        position,
        bounds,
        background,
        columns,
        media,
        heading,
        text,
        textLength: outerText.length,
        buttonCount: outer.querySelectorAll(BUTTON_SELECTOR).length,
        cardCount: Math.max(selectorCards, repeats ? repeats.count : 0),
        repeats,
      };
    }).sort((a, b) => a.bounds.y - b.bounds.y);
    results.bandsCapped = bandsCapped;

    // Stack fingerprint signals (v7)
    results.stack = {
      scripts: Array.from(document.scripts).map(s => s.src || s.getAttribute('data-src') || '').filter(Boolean).slice(0, 50),
      metas: Array.from(document.querySelectorAll('meta[name],meta[property]'))
        .map(m => ({ name: m.name || m.getAttribute('property'), content: m.content }))
        .slice(0, 50),
      classNameSample: Array.from(document.querySelectorAll('[class]'))
        .slice(0, 500)
        .map(e => typeof e.className === 'string' ? e.className : '')
        .filter(Boolean),
      // Unique class tokens across the first 5000 [class] elements, capped at
      // 2000 tokens. classNameSample (above) is only the first 500 elements'
      // whole class strings — a large header alone can run hundreds of
      // elements deep, so a stack signal that only shows up further down the
      // page (a swiper carousel, a fusion-lottie wrapper) never reaches it.
      // This is a wider, deduped net for exactly that case; classNameSample
      // itself is left as-is because component-library/stack-fingerprint
      // detection already depend on its exact shape.
      classTokens: (() => {
        const tokens = new Set();
        for (const el of Array.from(document.querySelectorAll('[class]')).slice(0, 5000)) {
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!cls) continue;
          for (const tok of cls.split(/\s+/)) {
            if (!tok) continue;
            tokens.add(tok);
            if (tokens.size >= 2000) break;
          }
          if (tokens.size >= 2000) break;
        }
        return Array.from(tokens);
      })(),
      windowGlobals: ['React', 'Vue', '__NEXT_DATA__', '__NUXT__', '___gatsby', '_remixContext', 'Shopify', 'wp',
        'gsap', 'ScrollTrigger', 'Lenis', 'LocomotiveScroll', 'AOS', 'lottie', 'bodymovin', 'Swiper', 'Motion']
        .filter(k => typeof window[k] !== 'undefined'),
      tagCounts: {
        'lottie-player': document.querySelectorAll('lottie-player').length,
        canvas: document.querySelectorAll('canvas').length,
        video: document.querySelectorAll('video').length,
      },
    };

    // SVG icons
    results.icons = [];
    for (const svg of document.querySelectorAll('svg')) {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 4 && rect.width < 200 && rect.height > 4 && rect.height < 200) {
        results.icons.push({
          svg: svg.outerHTML,
          width: rect.width,
          height: rect.height,
          viewBox: svg.getAttribute('viewBox') || '',
          classList: Array.from(svg.classList).join(' '),
          fill: svg.getAttribute('fill') || getComputedStyle(svg).fill || '',
          stroke: svg.getAttribute('stroke') || getComputedStyle(svg).stroke || '',
        });
      }
    }

    // Font data
    results.fontData = { fontFaces: [], googleFontsLinks: [], documentFonts: [] };
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSFontFaceRule) {
              results.fontData.fontFaces.push({
                family: rule.style.getPropertyValue('font-family').replace(/['"]/g, ''),
                style: rule.style.getPropertyValue('font-style') || 'normal',
                weight: rule.style.getPropertyValue('font-weight') || '400',
                src: rule.style.getPropertyValue('src') || '',
              });
            }
          }
        } catch { /* cross-origin — already tracked */ }
      }
    } catch {}
    for (const link of document.querySelectorAll('link[href*="fonts.googleapis.com"]')) {
      results.fontData.googleFontsLinks.push(link.href);
    }
    for (const font of document.fonts) {
      results.fontData.documentFonts.push({ family: font.family.replace(/['"]/g, ''), style: font.style, weight: font.weight, status: font.status });
    }

    // v10.3 — favicons, manifest, JSON-LD.
    results.favicons = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'))
      .slice(0, 10)
      .map(l => ({ rel: l.getAttribute('rel'), href: l.href, sizes: l.getAttribute('sizes') || '', type: l.getAttribute('type') || '' }));
    const manifestLink = document.querySelector('link[rel="manifest"]');
    results.manifest = manifestLink ? manifestLink.href : null;
    results.jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .slice(0, 12)
      .map(s => s.textContent || '')
      .filter(Boolean);

    // Image data
    results.images = [];
    for (const img of document.querySelectorAll('img, picture img, [role="img"]')) {
      const rect = img.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) continue;
      const cs = getComputedStyle(img);
      results.images.push({
        tag: img.tagName.toLowerCase(),
        src: realImageSrc(img).slice(0, 500),
        currentSrc: (img.currentSrc || '').slice(0, 500),
        lazyUnresolved: img.tagName.toLowerCase() === 'img' ? isLazyUnresolved(img) : false,
        width: rect.width,
        height: rect.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        loading: img.loading || '',
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        objectFit: cs.objectFit,
        objectPosition: cs.objectPosition,
        borderRadius: cs.borderRadius,
        filter: cs.filter,
        opacity: cs.opacity,
        aspectRatio: cs.aspectRatio,
        classList: Array.from(img.classList).join(' '),
      });
    }

    return results;
}

async function extractPageData(page, ignoreSelectors, scopeSelector) {
  const data = await page.evaluate(collectPageData, {
    maxElements: MAX_ELEMENTS,
    ignoreSelectors: ignoreSelectors || [],
    scopeSelector: scopeSelector || null,
  });

  // Fetch and parse cross-origin stylesheets
  if (data.crossOriginSheets && data.crossOriginSheets.length > 0) {
    const seen = new Set();
    for (const href of data.crossOriginSheets) {
      if (seen.has(href)) continue;
      seen.add(href);
      try {
        const cssText = await page.evaluate(async (url) => {
          const res = await fetch(url, { mode: 'cors' });
          return res.text();
        }, href);
        parseCrossOriginCSS(cssText, data);
      } catch { /* fetch failed too */ }
    }
  }
  delete data.crossOriginSheets;

  return data;
}

function parseCrossOriginCSS(cssText, data) {
  // Media queries
  for (const m of cssText.matchAll(/@media\s*([^{]+)\{/g)) {
    data.mediaQueries.push(m[1].trim());
  }
  // Container queries
  if (!data.containerQueries) data.containerQueries = [];
  for (const m of cssText.matchAll(/@container\s*([^{]*)\{/g)) {
    data.containerQueries.push({ condition: m[1].trim(), selectorText: '', declarationCount: 0 });
  }
  // Fluid declarations from cross-origin sheets fetched as text.
  if (!data.fluidValues) data.fluidValues = [];
  const FLUID_TEXT_RE = /(font-size|line-height|letter-spacing|gap|padding|padding-block|padding-inline|max-width|width|border-radius)\s*:\s*([^;}]*(?:clamp\(|[\d.]+v(?:w|h|min|max)\b)[^;}]*)/gi;
  for (const m of cssText.matchAll(FLUID_TEXT_RE)) {
    if (data.fluidValues.length >= 400) break;
    data.fluidValues.push({ property: m[1].toLowerCase(), value: m[2].trim(), selector: '' });
  }
  // env() usage
  if (!data.envUsage) data.envUsage = [];
  for (const m of cssText.matchAll(/env\(\s*(safe-area-inset-[a-z]+|viewport-[a-z-]+)/gi)) {
    data.envUsage.push(m[1]);
  }
  data.envUsage = [...new Set(data.envUsage)];
  // Modern colors
  if (!data.modernColors) data.modernColors = [];
  const modernRe = /(oklch\([^)]+\)|oklab\([^)]+\)|color-mix\([^)]+\)|light-dark\([^)]+\)|color\(\s*display-p3[^)]+\)|color\(\s*rec2020[^)]+\))/gi;
  for (const m of cssText.matchAll(modernRe)) {
    const raw = m[1];
    let type = 'other';
    if (/^oklch/i.test(raw)) type = 'oklch';
    else if (/^oklab/i.test(raw)) type = 'oklab';
    else if (/^color-mix/i.test(raw)) type = 'color-mix';
    else if (/^light-dark/i.test(raw)) type = 'light-dark';
    else if (/display-p3/i.test(raw)) type = 'display-p3';
    else if (/rec2020/i.test(raw)) type = 'rec2020';
    data.modernColors.push({ raw, type, property: '', selector: '' });
  }
  // Keyframes
  for (const m of cssText.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
    const steps = [];
    for (const s of m[2].matchAll(/([\d%,\s]+|from|to)\s*\{([^}]*)\}/g)) {
      steps.push({ offset: s[1].trim(), style: s[2].trim() });
    }
    if (steps.length > 0) data.keyframes.push({ name: m[1], steps });
  }
  // :root variables
  for (const rootBlock of cssText.matchAll(/:root\s*\{([^}]+)\}/g)) {
    for (const v of rootBlock[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (!data.cssVariables[v[1]]) data.cssVariables[v[1]] = v[2].trim();
    }
  }
  // @font-face
  for (const m of cssText.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const block = m[1];
    const family = block.match(/font-family\s*:\s*['"]?([^'";]+)/)?.[1]?.trim();
    const style = block.match(/font-style\s*:\s*([^;]+)/)?.[1]?.trim() || 'normal';
    const weight = block.match(/font-weight\s*:\s*([^;]+)/)?.[1]?.trim() || '400';
    const src = block.match(/src\s*:\s*([^;]+)/)?.[1]?.trim() || '';
    if (family) data.fontData.fontFaces.push({ family, style, weight, src });
  }
}
