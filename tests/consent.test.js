import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { neutralizeConsent, CONSENT_SELECTORS, REJECT_BUTTON_PATTERN } from '../src/consent.js';

let browser;
let page;

before(async () => {
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new Error(`chromium failed to launch — consent tests require a local chromium install: ${err.message}`);
  }
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
});

after(async () => {
  if (browser) await browser.close();
});

const TALL_BODY = '<main style="height:3000px"><h1>Brand</h1><p>Real content under the banner.</p></main>';

// A OneTrust-shaped banner: known root id, backdrop, body scroll lock, and
// both an accept and a reject control. The handlers record what was pressed.
function oneTrust({ reject = true } = {}) {
  return `<!DOCTYPE html><html><head><style>
    body { margin:0; overflow:hidden; }
    .onetrust-pc-dark-filter { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9998; }
    #onetrust-banner-sdk { position:fixed; left:0; right:0; bottom:0; height:220px; background:#fff; z-index:9999; }
  </style></head><body>
  <script>window.__accepted=false; window.__rejected=false;</script>
  ${TALL_BODY}
  <div id="onetrust-consent-sdk">
    <div class="onetrust-pc-dark-filter"></div>
    <div id="onetrust-banner-sdk" role="dialog" aria-label="Cookie banner">
      <p>We use cookies to personalise content and analyse our traffic.</p>
      <button id="onetrust-accept-btn-handler" onclick="window.__accepted=true">Accept All Cookies</button>
      ${reject ? '<button id="onetrust-reject-all-handler" onclick="window.__rejected=true; document.getElementById(\'onetrust-consent-sdk\').style.display=\'none\'; document.body.style.overflow=\'\'">Reject All</button>' : ''}
      <button id="onetrust-pc-btn-handler">Cookies Settings</button>
    </div>
  </div>
  </body></html>`;
}

const GENERIC = `<!DOCTYPE html><html><head><style>
  body { margin:0; }
  header { position:fixed; top:0; left:0; right:0; height:64px; background:#111; color:#fff; }
  .notice { position:fixed; bottom:24px; left:24px; width:420px; padding:24px; background:#fff; box-shadow:0 4px 24px rgba(0,0,0,.2); }
</style></head><body>
<header><nav>Products Pricing Docs</nav></header>
${TALL_BODY}
<div class="notice"><p>This site uses cookies to give you the best experience.</p><button>Got it</button></div>
</body></html>`;

const CLEAN = `<!DOCTYPE html><html><head><style>
  body { margin:0; overflow:hidden; }
  header { position:fixed; top:0; left:0; right:0; height:64px; background:#111; color:#fff; }
</style></head><body><header><nav>Products Pricing Docs</nav></header>${TALL_BODY}</body></html>`;

test('a known consent tool with a reject control is rejected, never accepted', async () => {
  await page.setContent(oneTrust());
  const result = await neutralizeConsent(page);
  assert.equal(result.action, 'rejected');
  assert.ok(result.detected.includes('#onetrust-consent-sdk'), `detected: ${result.detected}`);
  assert.equal(await page.evaluate(() => window.__accepted), false);
  assert.equal(await page.evaluate(() => window.__rejected), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY === 'hidden'), false);
});

test('a known consent tool with only an accept control is hidden, and the scroll lock is released', async () => {
  await page.setContent(oneTrust({ reject: false }));
  const result = await neutralizeConsent(page);
  assert.equal(result.action, 'hidden');
  assert.equal(result.scrollLockReleased, true);
  assert.equal(await page.evaluate(() => window.__accepted), false);
  const visible = await page.evaluate(() => {
    const isShown = (el) => !!el && el.getClientRects().length > 0;
    return { banner: isShown(document.querySelector('#onetrust-banner-sdk')), backdrop: isShown(document.querySelector('.onetrust-pc-dark-filter')) };
  });
  assert.deepEqual(visible, { banner: false, backdrop: false });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY === 'hidden'), false);
  await page.evaluate(() => window.scrollTo(0, 500));
  assert.ok((await page.evaluate(() => window.scrollY)) > 0, 'page scrolls after the lock is released');
});

test('a banner with no known selector is found by its shape and text, and a fixed header is left alone', async () => {
  await page.setContent(GENERIC);
  const result = await neutralizeConsent(page);
  assert.equal(result.action, 'hidden');
  assert.ok(result.detected.some(d => d.startsWith('generic:')), `detected: ${result.detected}`);
  const state = await page.evaluate(() => ({
    notice: getComputedStyle(document.querySelector('.notice')).display,
    header: getComputedStyle(document.querySelector('header')).display,
  }));
  assert.equal(state.notice, 'none');
  assert.equal(state.header, 'block');
});

test('a page without a consent banner is untouched', async () => {
  await page.setContent(CLEAN);
  const result = await neutralizeConsent(page);
  assert.deepEqual(result, { detected: [], action: 'none', scrollLockReleased: false, ignored: [] });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden', 'no banner, so the page\'s own overflow rule stands');
});

test('the reject pattern accepts refusal wording and refuses acceptance wording', () => {
  for (const t of ['Reject All', 'Decline', 'Deny all cookies', 'Only necessary', 'Necessary cookies only', 'Continue without accepting', 'Refuse', 'Disagree', 'No, thanks']) {
    assert.ok(REJECT_BUTTON_PATTERN.test(t), `should match: ${t}`);
  }
  for (const t of ['Accept All Cookies', 'Allow all', 'Got it', 'OK', 'Cookies Settings', 'Manage preferences', 'I agree', 'Reject cookies and lose my discount forever, this is a long label']) {
    assert.equal(REJECT_BUTTON_PATTERN.test(t), false, `should not match: ${t}`);
  }
  assert.ok(CONSENT_SELECTORS.includes('#onetrust-consent-sdk'));
});

const AGE_GATE = `<!DOCTYPE html><html><head><style>
  body { margin:0; overflow:hidden; }
  .age-wrapper { position:fixed; inset:0; background:#000; color:#fff; z-index:99; }
  .drawer { position:fixed; top:0; right:-400px; width:400px; height:100%; background:#fff; }
</style></head><body>
${TALL_BODY}
<div class="age-wrapper"><h2>Please confirm that you're of legal drinking age</h2><p>21 YEARS</p><button>Enter</button><p>By entering you accept the use of cookies to enhance your user experience.</p></div>
<div class="drawer"><p>Your cart is empty. Enable cookies to use the shopping cart.</p><button>Checkout</button></div>
</body></html>`;

test('an age gate that mentions cookies is left in place, and an off-screen drawer is not a banner', async () => {
  await page.setContent(AGE_GATE);
  const result = await neutralizeConsent(page);
  assert.equal(result.action, 'none');
  assert.deepEqual(result.detected, []);
  assert.deepEqual(result.ignored, ['age-gate:div.age-wrapper']);
  const state = await page.evaluate(() => ({
    gate: getComputedStyle(document.querySelector('.age-wrapper')).display,
    drawer: getComputedStyle(document.querySelector('.drawer')).display,
    overflow: getComputedStyle(document.body).overflowY,
  }));
  assert.deepEqual(state, { gate: 'block', drawer: 'block', overflow: 'hidden' });
});

// N26-shaped: the whole banner is rendered inside an open shadow root.
const SHADOW = `<!DOCTYPE html><html><head><style>body { margin:0; overflow:hidden; }</style></head><body>
<script>window.__accepted=false; window.__rejected=false;</script>
${TALL_BODY}
<div id="cmp-host"></div>
<script>
  const root = document.getElementById('cmp-host').attachShadow({ mode: 'open' });
  root.innerHTML = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483639"></div>'
    + '<div style="position:fixed;left:0;right:0;bottom:0;height:240px;background:#fff;z-index:2147483640"><h3>We care about your privacy</h3>'
    + '<p>N26 uses certain cookies and similar technologies to offer our services.</p>'
    + '<button onclick="window.__rejected=true; document.getElementById(\\'cmp-host\\').remove(); document.body.style.overflow=\\'\\'">Reject All</button>'
    + '<button onclick="window.__accepted=true">Accept All</button></div>';
</script>
</body></html>`;

test('a banner rendered inside a shadow root is found and rejected', async () => {
  await page.setContent(SHADOW);
  const result = await neutralizeConsent(page);
  assert.equal(result.action, 'rejected');
  assert.ok(result.detected.some(d => d.startsWith('generic:')), `detected: ${result.detected}`);
  assert.equal(await page.evaluate(() => window.__accepted), false);
  assert.equal(await page.evaluate(() => window.__rejected), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY === 'hidden'), false);
});

test('the crawler runs the consent step before it measures anything, on every page it loads', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/crawler.js', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/neutralizeConsent\(/g)].map(m => m.index);
  assert.equal(calls.length, 3, 'main page, each multipage link, and the dark-mode page');
  assert.ok(calls[0] < src.indexOf('stopCSSCoverage'), 'main page: before CSS coverage is read');
  assert.ok(calls[0] < src.indexOf('runInteractionPass(page)'), 'main page: before the scroll pass');
  assert.ok(calls[0] < src.indexOf('extractPageData(page, ignore, selector)'), 'main page: before the collector');
  assert.ok(src.includes('dismissConsent = true'), 'on by default');
});
