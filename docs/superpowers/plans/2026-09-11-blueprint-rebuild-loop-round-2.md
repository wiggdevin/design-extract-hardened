# Blueprint Rebuild Loop, Round Two: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve lazy media, describe embeds, repeated card structure, inherited backgrounds and overlay bands in the blueprint, close two round-one leaks, add one benchmark gate, then rebuild and score the reference page a second time.

**Architecture:** All page-side changes live inside the self-contained `collectPageData` function in `src/crawler.js` (it is serialised into the page, so helpers are declared inside it). Pure changes live in `src/extractors/blueprint.js`, `src/extractors/section-roles.js`, `src/fidelity/blueprint-fidelity.js`, `src/semantic-benchmark.js`. The fidelity screenshot lane joins the safe proxy in `src/fidelity/run.js`. Tests are node:test files run one at a time; browser tests use Playwright with `page.setContent` and a routed `http://fixture.test/**` PNG.

**Tech Stack:** Node 22, Playwright (already a dependency), node:test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-blueprint-rebuild-loop-round-2-design.md`

## Global Constraints

- No new dependencies.
- Crawler safety preserved: safe browsing proxy, redirect and IP validation, no remote browser, bounded collection budgets, no unrestricted secondary fetch. The only loopback allowance is `fidelity --clone-local`, clone side only.
- No page copy, raw HTML, MHTML, font bytes, image bytes, cookies, headers, or authenticated content in output. URLs are allowed; band `text` and section `text` are classifier-only and must not reach output or `_raw`.
- Anything from the page that reaches the agent brief passes a whole-string allowlist.
- Never run the full test suite locally; run the named test files per task with `node --test tests/<file>`.
- Git: `/usr/bin/git`, one command per call, commit with `-q -F <message file>` written by the Write tool, never amend, never stash, never add `scratchpad/` or `benchmarks/results/`. Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- No em dashes in new prose. Fixtures use `http://fixture.test/...` URLs routed to a 1x1 PNG.
- Scratch files go to `/private/tmp/claude-501/-Users-zero-suminc-/f909e6da-8f65-4b4d-bf20-9d56d3925f74/scratchpad/` (referred to below as `<scratch>`).

## File map

| File | Change |
|---|---|
| `src/crawler.js` (`collectPageData`) | `isPlaceholderSrc`, `absUrl`, hoisted `firstSrcsetUrl`, `realImageSrc`; band media reads them and includes `iframe/embed/object` as `embed`; `media.poster`; `background.inherited`; `bgOf` reads `data-bg`; `repeats`; `cardCount`/`columns` use repeats; `results.images[].lazyUnresolved` |
| `src/crawler.js` (`waitForImages`) | `placeholders` count |
| `src/extractors/blueprint.js` | carry `repeats`, `overlay`; pass `repeats` to `classifyRole` |
| `src/extractors/section-roles.js` | feature-grid rule on repeats |
| `src/fidelity/blueprint-fidelity.js` | skip overlay bands |
| `src/fidelity/run.js` | screenshot lane through the safe proxy |
| `src/index.js` | strip section text |
| `src/semantic-benchmark.js` | placeholder media gate |
| `bin/design-extract.js`, `SECURITY.md`, `README.md`, `CHANGELOG.md` | docs |
| `tests/fixtures/lazy-placeholders.html`, `blueprint-embed.html`, `blueprint-card-grid.html` | new fixtures |
| `tests/lazy-media.test.js` (new), `tests/blueprint-collector.test.js`, `tests/scroll-capture.test.js`, `tests/blueprint.test.js`, `tests/blueprint-fidelity.test.js`, `tests/fidelity-loop.test.js`, `tests/semantic-benchmark.test.js` | tests |
| `benchmarks/rebuild/odyssey-round-2/`, `benchmarks/rebuild-round-2.md` | rebuild and report |

---

### Task 1: Lazy media resolution

**Files:**
- Modify: `src/crawler.js` (`collectPageData` band media around line 1600, `results.images` around line 1760, `bgOf` around line 1524; `waitForImages` line 529)
- Create: `tests/fixtures/lazy-placeholders.html`, `tests/lazy-media.test.js`
- Modify: `tests/scroll-capture.test.js` (append)

**Interfaces:**
- Produces: band `media.src` resolved from lazy attributes; `results.images[].lazyUnresolved` boolean; `waitForImages()` returns `{ total, incomplete, placeholders }`; `background.imageUrl` from `data-bg`.

- [ ] **Step 1: Write the fixture**

`tests/fixtures/lazy-placeholders.html` (the placeholder is a transparent 576 by 384 SVG, the lazysizes shape observed on the reference page):

```html
<!doctype html>
<html><head><style>
  body { margin: 0; background: #ffffff; font-family: sans-serif; }
  header { height: 80px; background: #111; }
  section { height: 700px; width: 100%; box-sizing: border-box; padding: 40px; }
  footer { height: 200px; background: #222; }
  img { display: block; }
  .bg { width: 1280px; height: 600px; }
  video { width: 1280px; height: 600px; display: block; }
</style></head><body>
<header></header>
<section class="lazy-a">
  <h2>Additions</h2>
  <img class="lazyload" width="576" height="384"
       src="data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27576%27%20height%3D%27384%27%3E%3C%2Fsvg%3E"
       data-orig-src="http://fixture.test/img/a.png"
       data-srcset="http://fixture.test/img/a-2x.png 2x"
       data-sizes="auto" alt="">
</section>
<section class="native-b">
  <h2>Sunrooms</h2>
  <img width="576" height="384" srcset="http://fixture.test/img/b.png 1x" alt="">
</section>
<section class="bg-c" style="padding:0">
  <div class="bg" data-bg="http://fixture.test/img/c.png"></div>
</section>
<section class="video-d" style="padding:0">
  <video poster="http://fixture.test/img/poster.png" muted><source src="http://fixture.test/v.webm" type="video/webm"></video>
</section>
<footer></footer>
</body></html>
```

- [ ] **Step 2: Write the failing tests**

`tests/lazy-media.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectPageData } from '../src/crawler.js';

const fixtureHtml = readFileSync(fileURLToPath(new URL('./fixtures/lazy-placeholders.html', import.meta.url)), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const COLLECT_OPTS = { maxElements: 5000, ignoreSelectors: [], scopeSelector: null };

let browser; let page; let data;
before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.setContent(fixtureHtml);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))));
  data = await page.evaluate(collectPageData, COLLECT_OPTS);
});
after(async () => { if (browser) await browser.close(); });

const band = (cls) => data.bands.find((b) => b.className.includes(cls));

test('a lazysizes placeholder resolves to the data-orig-src URL as photo media', () => {
  const a = band('lazy-a');
  assert.equal(a.media.kind, 'photo');
  assert.equal(a.media.src, 'http://fixture.test/img/a.png');
  assert.ok(a.media.share >= 0.2, `share ${a.media.share}`);
});

test('a natively loaded srcset image keeps its currentSrc', () => {
  const b = band('native-b');
  assert.equal(b.media.kind, 'photo');
  assert.equal(b.media.src, 'http://fixture.test/img/b.png');
});

test('data-bg on an unpainted block becomes the band background image and photo media', () => {
  const c = band('bg-c');
  assert.equal(c.background.imageUrl, 'http://fixture.test/img/c.png');
  assert.equal(c.media.kind, 'photo');
});

test('a video band records its poster', () => {
  const d = band('video-d');
  assert.equal(d.media.kind, 'video');
  assert.equal(d.media.poster, 'http://fixture.test/img/poster.png');
  assert.equal(d.background.hasVideo, true);
});

test('results.images marks the unresolved placeholder and resolves its src', () => {
  const lazy = data.images.find((i) => i.classList.includes('lazyload'));
  assert.equal(lazy.lazyUnresolved, true);
  assert.equal(lazy.src, 'http://fixture.test/img/a.png');
  assert.ok(lazy.currentSrc.startsWith('data:image/svg+xml'));
  const native = data.images.find((i) => i.src === 'http://fixture.test/img/b.png');
  assert.equal(native.lazyUnresolved, false);
});
```

Append to `tests/scroll-capture.test.js` (reuse its `PNG` and route pattern; open a fresh page on the lazy fixture):

```js
test('waitForImages counts placeholder images that still carry a lazy attribute', async () => {
  const lazyHtml = readFileSync(fileURLToPath(new URL('./fixtures/lazy-placeholders.html', import.meta.url)), 'utf8');
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await p.setContent(lazyHtml);
  const r = await waitForImages(p, { timeoutMs: 1000 });
  assert.equal(r.placeholders, 1, JSON.stringify(r));
  await p.close();
});
```

(Check the top of `tests/scroll-capture.test.js` for how `browser`, `readFileSync`, `fileURLToPath`, and `waitForImages` are imported and reuse those names.)

- [ ] **Step 3: Run to verify they fail**

`node --test tests/lazy-media.test.js tests/scroll-capture.test.js`
Expected: lazy-a `media.src` is the `data:` placeholder; `media.poster` undefined; `lazyUnresolved` undefined; `placeholders` undefined.

- [ ] **Step 4: Implement in `collectPageData`**

Directly after `bgOf` (around line 1524), add and change:

```js
    const isPlaceholderSrc = (s) => !s || /^data:/i.test(s) || /^about:blank$/i.test(s);
    const absUrl = (u) => { try { return new URL(u, location.href).href; } catch { return u || ''; } };
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
      if (!isPlaceholderSrc(cur)) return cur;
      const attr = img.getAttribute('src') || '';
      if (!isPlaceholderSrc(attr)) return absUrl(attr);
      const picture = img.closest('picture');
      const source = picture && picture.querySelector('source[srcset]');
      const candidates = [
        img.getAttribute('data-orig-src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
        firstSrcsetUrl(img.getAttribute('data-srcset')), firstSrcsetUrl(img.getAttribute('srcset')),
        source ? firstSrcsetUrl(source.getAttribute('srcset')) : '',
      ];
      for (const c of candidates) if (c && !isPlaceholderSrc(c)) return absUrl(c);
      return cur || attr || '';
    };
    const isLazyUnresolved = (img) => isPlaceholderSrc(img.currentSrc || img.getAttribute('src') || '')
      && ['data-orig-src', 'data-src', 'data-lazy-src', 'data-srcset'].some((a) => img.hasAttribute(a));
```

Change `bgOf` to read lazy background attributes when the computed image is `none`:

```js
    const bgOf = (el) => {
      const cs = getComputedStyle(el);
      const color = toHex(cs.backgroundColor);
      const url = (cs.backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/);
      let imageUrl = url ? url[1].slice(0, 500) : null;
      if (!imageUrl) {
        const lazy = el.getAttribute('data-bg') || el.getAttribute('data-background-image') || '';
        if (lazy && !isPlaceholderSrc(lazy)) imageUrl = absUrl(lazy).slice(0, 500);
      }
      return { color, imageUrl };
    };
```

Delete the later `function firstSrcsetUrl` declaration in the `results.images` block (it is now hoisted above) and change the image record:

```js
      results.images.push({
        tag: img.tagName.toLowerCase(),
        src: realImageSrc(img).slice(0, 500),
        currentSrc: (img.currentSrc || '').slice(0, 500),
        lazyUnresolved: img.tagName.toLowerCase() === 'img' ? isLazyUnresolved(img) : false,
```

(The `srcsetCandidate` and `picture` locals in that loop become unused; remove them.)

In the band media loop, the `img` branch becomes:

```js
        if (tag === 'img') {
          const src = realImageSrc(el).slice(0, 500);
          consider(/\.svg(\?|$)/i.test(src) ? 'svg' : 'photo', a, src);
        } else if (tag === 'video') {
          const source = el.querySelector('source');
          const poster = el.getAttribute('poster');
          if (poster && !videoPoster) videoPoster = absUrl(poster).slice(0, 500);
          consider('video', a, (el.currentSrc || el.getAttribute('src') || (source && source.getAttribute('src')) || poster || '').slice(0, 500));
        }
```

Declare `let videoPoster = null;` beside `const kinds = ...`, and after `media` is built add `if (kind === 'video') media.poster = videoPoster;`.

`waitForImages`:

```js
  return page.evaluate(() => {
    const withSrc = Array.from(document.images).filter((img) => img.getAttribute('src'));
    const isPlaceholder = (s) => !s || /^data:/i.test(s);
    const placeholders = Array.from(document.images).filter((img) => isPlaceholder(img.currentSrc || img.getAttribute('src') || '')
      && ['data-orig-src', 'data-src', 'data-lazy-src', 'data-srcset'].some((a) => img.hasAttribute(a))).length;
    return { total: withSrc.length, incomplete: withSrc.filter((img) => !img.complete).length, placeholders };
  }).catch(() => ({ total: 0, incomplete: 0, placeholders: 0 }));
```

- [ ] **Step 5: Run to verify they pass**

`node --test tests/lazy-media.test.js tests/scroll-capture.test.js tests/blueprint-collector.test.js tests/collector-hygiene.test.js tests/extractors.test.js`
Expected: all pass, output pristine. If `tests/extractors.test.js` or another existing test asserts an image `src` that a `data:` placeholder used to satisfy, read the assertion and report it; do not weaken the helper.

- [ ] **Step 6: Commit**

Write `<scratch>/commit-msg-r2-1.txt`:

```
fix: resolve lazy image sources and record video posters in band media

lazysizes parks a transparent data: SVG in src and keeps the real URL in
data-orig-src or data-srcset until its script swaps it in; the band
media collector read currentSrc first, so sixteen of eighteen images on
the reference page came out as placeholders. A shared realImageSrc
helper now prefers a real URL from the lazy attributes, results.images
marks unresolved placeholders, waitForImages counts them, bgOf reads
data-bg, and a video band records its poster or null.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

`/usr/bin/git add src/crawler.js tests/lazy-media.test.js tests/scroll-capture.test.js tests/fixtures/lazy-placeholders.html`
`/usr/bin/git commit -q -F <scratch>/commit-msg-r2-1.txt`

---

### Task 2: Embeds as band media

**Files:**
- Modify: `src/crawler.js` (band media loop)
- Create: `tests/fixtures/blueprint-embed.html`
- Modify: `tests/blueprint-collector.test.js` (append a second fixture block)

**Interfaces:**
- Produces: `media.kind` may be `'embed'`; `media.src` is the iframe URL from `src`, `data-lazy-src`, or `data-src`.

- [ ] **Step 1: Fixture**

`tests/fixtures/blueprint-embed.html`:

```html
<!doctype html>
<html><head><style>
  body { margin: 0; background: #fff; }
  header { height: 80px; background: #111; }
  section { width: 100%; box-sizing: border-box; padding: 40px; }
  .hero { height: 700px; background: #f3efe6; }
  .reviews { height: 960px; background: #bbc7d4; }
  .after { height: 700px; }
  footer { height: 200px; background: #222; }
  iframe { width: 1200px; height: 150px; border: 0; display: block; }
</style></head><body>
<header></header>
<section class="hero"><h1>Homes built to last</h1></section>
<section class="reviews"><h2>Ratings &amp; Reviews</h2><iframe data-lazy-src="http://fixture.test/embed/reviews" title="reviews"></iframe></section>
<section class="after"><h2>After</h2></section>
<footer></footer>
</body></html>
```

- [ ] **Step 2: Failing test**

Append to `tests/blueprint-collector.test.js` a `describe`-free block that opens a second page on this fixture (same `PNG` route, same `COLLECT_OPTS`):

```js
test('a lazy iframe under a heading is embed media with its lazy URL', async () => {
  const html = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-embed.html', import.meta.url)), 'utf8');
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await p.setContent(html);
  const d = await p.evaluate(collectPageData, COLLECT_OPTS);
  const reviews = d.bands.find((b) => b.className.includes('reviews'));
  assert.equal(reviews.media.kind, 'embed');
  assert.equal(reviews.media.src, 'http://fixture.test/embed/reviews');
  assert.ok(reviews.media.share >= 0.1 && reviews.media.share <= 0.2, `share ${reviews.media.share}`);
  await p.close();
});
```

Run `node --test tests/blueprint-collector.test.js`; expected failure: `media.kind` is `'none'`.

- [ ] **Step 3: Implement**

In the band media block, change `kinds` and `largest` to include `embed`, widen the selector, and add the branch:

```js
      const kinds = { photo: 0, video: 0, svg: 0, canvas: 0, embed: 0 };
      const largest = { photo: null, video: null, svg: null, canvas: null, embed: null };
      ...
      for (const el of outer.querySelectorAll('img, video, svg, canvas, iframe, embed, object')) {
        ...
        } else if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
          const src = el.getAttribute('src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-src') || el.getAttribute('data') || '';
          consider('embed', a, isPlaceholderSrc(src) ? null : absUrl(src).slice(0, 500));
        } else {
          consider(tag, a, null);
        }
```

`totalMedia` adds `kinds.embed`.

- [ ] **Step 4: Verify**

`node --test tests/blueprint-collector.test.js tests/lazy-media.test.js tests/blueprint.test.js`
Expected: pass.

- [ ] **Step 5: Commit**

Message file `<scratch>/commit-msg-r2-2.txt`:

```
feat: band media records iframes and embeds as kind embed

The reviews band on the reference page holds one lazy iframe and read
as media none. Iframes, embeds and objects now count toward band media
as kind embed with their src or lazy URL, so a rebuild knows an embed
of that size lives there.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 3: Repeated structure, card count, and the feature-grid role

**Files:**
- Modify: `src/crawler.js` (band record: `repeats`, `cardCount`, `columns`)
- Modify: `src/extractors/blueprint.js` (carry `repeats`, pass to `classifyRole`)
- Modify: `src/extractors/section-roles.js` (rule before testimonial)
- Create: `tests/fixtures/blueprint-card-grid.html`
- Modify: `tests/blueprint-collector.test.js`, `tests/blueprint.test.js` (append)

**Interfaces:**
- Produces: band `repeats: { count, w, h, perRow, withImage, withButton } | null`; `classifyRole` accepts `s.repeats`; blueprint bands carry `repeats`.

- [ ] **Step 1: Fixture**

`tests/fixtures/blueprint-card-grid.html` (the Avada shape from the probe: a fullwidth around a site-width row around a full-row heading column and ten half-width card columns; the page is tall enough that the grid is under 80 percent of it):

```html
<!doctype html>
<html><head><style>
  body { margin: 0; background: #fff; font-family: sans-serif; }
  header { height: 80px; background: #111; }
  .pad { height: 800px; width: 100%; }
  .fusion-fullwidth { width: 100%; background: #2c3142; color: #fff; }
  .fusion-builder-row { max-width: 1248px; margin: 0 auto; display: flex; flex-wrap: wrap; }
  .col-full { width: 100%; height: 108px; box-sizing: border-box; }
  .col-half { width: 50%; height: 616px; box-sizing: border-box; padding: 16px; }
  .col-half img { display: block; width: 576px; height: 384px; }
  .btn { display: inline-block; padding: 12px 20px; background: #f4a53c; color: #111; }
  footer { height: 200px; background: #222; }
</style></head><body>
<header></header>
<div class="pad"></div>
<div class="fusion-fullwidth reviews-grid">
  <div class="fusion-builder-row">
    <div class="col-full"><h2>Home Remodeling Services</h2></div>
    <div class="col-half"><img src="http://fixture.test/img/s1.png" alt=""><h3>Additions</h3><p>Expand your living space.</p><a class="btn" href="#">Home Additions</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s2.png" alt=""><h3>Sunrooms</h3><p>Enjoy the outdoors.</p><a class="btn" href="#">Sunrooms</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s3.png" alt=""><h3>Decks</h3><p>Durable decks.</p><a class="btn" href="#">Decks</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s4.png" alt=""><h3>Roofing</h3><p>Roof repair.</p><a class="btn" href="#">Roofing</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s5.png" alt=""><h3>Siding</h3><p>Siding upgrades.</p><a class="btn" href="#">Siding</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s6.png" alt=""><h3>Windows</h3><p>Replacement windows.</p><a class="btn" href="#">Windows</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s7.png" alt=""><h3>Doors</h3><p>Entry doors.</p><a class="btn" href="#">Doors</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s8.png" alt=""><h3>Gutters</h3><p>Custom gutters.</p><a class="btn" href="#">Gutters</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s9.png" alt=""><h3>Kitchens</h3><p>Kitchen remodeling.</p><a class="btn" href="#">Kitchens</a></div>
    <div class="col-half"><img src="http://fixture.test/img/s10.png" alt=""><h3>Bathrooms</h3><p>Bathroom remodeling.</p><a class="btn" href="#">Bathrooms</a></div>
  </div>
</div>
<div class="pad"></div>
<footer></footer>
</body></html>
```

- [ ] **Step 2: Failing tests**

Append to `tests/blueprint-collector.test.js`:

```js
test('a repeated card grid records repeats, uses them for cardCount and columns', async () => {
  const html = readFileSync(fileURLToPath(new URL('./fixtures/blueprint-card-grid.html', import.meta.url)), 'utf8');
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.route('http://fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await p.setContent(html);
  const d = await p.evaluate(collectPageData, COLLECT_OPTS);
  const grid = d.bands.find((b) => b.className.includes('reviews-grid'));
  assert.ok(grid, JSON.stringify(d.bands.map((b) => b.className)));
  assert.deepEqual(grid.repeats, { count: 10, w: 624, h: 616, perRow: 2, withImage: 10, withButton: 10 });
  assert.equal(grid.columns, 2);
  assert.ok(grid.cardCount >= 10, `cardCount ${grid.cardCount}`);
  const header = d.bands.find((b) => b.tag === 'header');
  assert.equal(header.repeats, null);
  await p.close();
});
```

Append to `tests/blueprint.test.js` (uses its existing `band()` helper; add `repeats` to the record):

```js
describe('repeated cards with buttons beat the testimonial class hint', () => {
  const bands = [
    band({ tag: 'header', position: 'fixed', bounds: { x: 0, y: 0, w: 1280, h: 80 }, text: '' }),
    band({ tag: 'div', className: 'fusion-fullwidth reviews-grid', bounds: { x: 0, y: 880, w: 1280, h: 3188 },
      heading: { level: 2, fontSize: 36, text: 'Home Remodeling Services' }, buttonCount: 10, cardCount: 1,
      repeats: { count: 10, w: 624, h: 616, perRow: 2, withImage: 10, withButton: 10 }, text: 'Additions Sunrooms Decks' }),
    band({ tag: 'div', className: 'fusion-fullwidth quotes', bounds: { x: 0, y: 4068, w: 1280, h: 900 },
      heading: { level: 2, fontSize: 36, text: 'What homeowners say' }, buttonCount: 0, cardCount: 0,
      repeats: { count: 4, w: 600, h: 300, perRow: 2, withImage: 0, withButton: 0 }, text: '"They were on time and on budget" — Jane Doe' }),
  ];
  const bp = extractBlueprint(bands, [], { type: 'landing' }, { pageHeight: 6000, viewportHeight: 800 });
  it('classifies the card grid as feature-grid and carries repeats', () => {
    const grid = bp.bands.find((b) => b.className.includes('reviews-grid'));
    assert.equal(grid.role, 'feature-grid');
    assert.deepEqual(grid.repeats, bands[1].repeats);
  });
  it('leaves a quote grid without buttons as testimonial', () => {
    assert.equal(bp.bands.find((b) => b.className.includes('quotes')).role, 'testimonial');
  });
  it('records without repeats carry null', () => {
    assert.equal(bp.bands[0].repeats, null);
  });
});
```

Run `node --test tests/blueprint-collector.test.js tests/blueprint.test.js`; expected failures: `repeats` undefined; role `testimonial` for the grid.

- [ ] **Step 3: Implement the collector side**

Inside the band record builder in `collectPageData`, before `return { tag: ... }`:

```js
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
                  best = {
                    count: members.length,
                    w: Math.round(members[0].r.width),
                    h: Math.round(median),
                    perRow: members.filter((b) => Math.abs(b.r.top - top0) <= 10).length,
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
      if (repeats && repeats.perRow >= 2) columns = repeats.perRow;
      const selectorCards = outer.querySelectorAll(CARD_SELECTOR).length;
```

and in the returned record: `repeats,` and `cardCount: Math.max(selectorCards, repeats ? repeats.count : 0),`. `columns` is declared with `let` in the existing rule; keep that declaration and apply the override after the rule.

- [ ] **Step 4: Implement the pure side**

`src/extractors/section-roles.js`, insert before the testimonial rule:

```js
  // A grid of four or more same-size cards where at least half carry a
  // button is a feature or services grid, whatever its class says. A
  // testimonial carousel repeats too, but its cards are quotes, not CTAs.
  if (s.repeats && s.repeats.count >= 4 && s.repeats.withButton >= s.repeats.count * 0.5) {
    return { role: 'feature-grid', subrole: 'cards', confidence: 0.85 };
  }
```

`src/extractors/blueprint.js`: pass `repeats: b.repeats || null` into the `classifyRole` record and add `repeats: b.repeats || null,` to the output band after `cardCount`.

- [ ] **Step 5: Verify**

`node --test tests/blueprint-collector.test.js tests/blueprint.test.js tests/v10-features.test.js tests/section-roles-source.test.js tests/semantic-output-contract.test.js`
Expected: pass. `tests/semantic-output-contract.test.js` may pin the band key set; if it does, add `repeats` there.

- [ ] **Step 6: Commit**

`<scratch>/commit-msg-r2-3.txt`:

```
feat: bands record repeated card structure; buttoned grids are feature grids

The services band on the reference page held ten same-size columns with
an image and a button each, but cardCount read 1 (no card-like class)
and the role fell to testimonial on a class hint. Each band now records
repeats (count, size, per row, with image, with button) from its
largest same-size sibling group; cardCount and columns use it, and a
grid of four or more cards where half carry a button classifies as
feature-grid before the testimonial rule.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 4: Background inheritance

**Files:**
- Modify: `src/crawler.js` (band background)
- Modify: `tests/lazy-media.test.js` (append; its fixture has unpainted sections on a white body) and `tests/blueprint-collector.test.js` (append one assertion on the existing hero)

- [ ] **Step 1: Failing tests**

`tests/lazy-media.test.js`:

```js
test('an unpainted band inherits the nearest painted ancestor background and says so', () => {
  const a = band('lazy-a');
  assert.equal(a.background.color, '#ffffff');
  assert.equal(a.background.inherited, true);
});
```

`tests/blueprint-collector.test.js`, in the hero test: `assert.equal(hero.background.inherited, false);`

Run both files; expected: `inherited` undefined, `color` null.

- [ ] **Step 2: Implement**

After the descendant background search in the band builder:

```js
      let inherited = false;
      if (!background.color && !background.imageUrl) {
        for (let el = outer.parentElement; el; el = el.parentElement) {
          const bg = bgOf(el);
          if (bg.color || bg.imageUrl) { background = { color: bg.color, imageUrl: bg.imageUrl }; inherited = true; break; }
        }
      }
      background.inherited = inherited;
```

(Keep the `hasVideo` line after it.)

- [ ] **Step 3: Verify and commit**

`node --test tests/lazy-media.test.js tests/blueprint-collector.test.js tests/blueprint.test.js tests/blueprint-fidelity.test.js`

`<scratch>/commit-msg-r2-4.txt`:

```
fix: unpainted bands inherit the nearest painted ancestor background

Five bands on the reference page recorded background null because they
paint nothing themselves; the page body paints white. The band record
now walks up to the first painted ancestor and marks the result
inherited so a rebuild renders the real surface instead of guessing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 5: Overlay bands in the blueprint and the fidelity scorer

**Files:**
- Modify: `src/extractors/blueprint.js`, `src/fidelity/blueprint-fidelity.js`
- Modify: `tests/blueprint.test.js`, `tests/blueprint-fidelity.test.js` (append)

- [ ] **Step 1: Failing tests**

`tests/blueprint.test.js`:

```js
describe('overlay bands: fixed or absolute, or contained in an earlier band', () => {
  const bands = [
    band({ tag: 'header', position: 'fixed', bounds: { x: 0, y: 0, w: 1280, h: 107 }, text: '' }),
    band({ tag: 'div', className: 'fullwidth-video', position: 'relative', bounds: { x: 0, y: 0, w: 1280, h: 800 }, media: { kind: 'video', share: 1, src: 'https://example.com/v.webm' }, text: '' }),
    band({ tag: 'div', className: 'fusion-builder-row hero-copy', position: 'relative', bounds: { x: 0, y: 0, w: 1280, h: 800 }, heading: { level: 1, fontSize: 65, text: 'Trusted' }, text: 'Trusted' }),
    band({ tag: 'div', className: 'fusion-fullwidth intro', position: 'relative', bounds: { x: 0, y: 800, w: 1280, h: 144 }, text: '' }),
  ];
  const bp = extractBlueprint(bands, [], { type: 'landing' }, { pageHeight: 10822, viewportHeight: 800 });
  it('marks the fixed nav and the contained headline row, not the video or the next band', () => {
    assert.deepEqual(bp.bands.map((b) => b.overlay), [true, false, true, false]);
  });
  it('keeps the reading order and hero unchanged', () => {
    assert.equal(bp.readingOrder.length, 4);
    assert.equal(bp.heroIndex, 1);
  });
});
```

`tests/blueprint-fidelity.test.js`:

```js
describe('overlay bands are skipped when aligning', () => {
  const b = (role, h, overlay = false) => ({ role, overlay, bounds: { h }, background: { color: '#ffffff' }, columns: 1, media: { kind: 'none' } });
  it('a clone that stacks overlays on the band before them is not drift', () => {
    const original = { bands: [b('nav', 107, true), b('hero', 800), b('hero', 800, true), b('content', 144)] };
    const clone = { bands: [b('hero', 800), b('content', 144)] };
    const r = scoreBlueprintFidelity(original, clone);
    assert.equal(r.aligned, 2);
    assert.equal(r.unmatchedBands, 0);
    assert.equal(r.driftSuspected, false);
    assert.equal(r.score, 100);
  });
});
```

Run both; expected: `overlay` undefined; `aligned 2, unmatched 2`.

- [ ] **Step 2: Implement**

`src/extractors/blueprint.js`:

```js
const OVERLAY_TOLERANCE_PX = 8;

// A band that sits on top of another rather than after it: pinned or
// absolutely positioned, or its box lies inside an earlier band's box (a
// headline row inside a full-bleed video wrapper). A rebuild stacks these
// on the band before them; they add no height to the page.
function isOverlay(b, earlier) {
  if (b.position === 'fixed' || b.position === 'absolute') return true;
  const t = OVERLAY_TOLERANCE_PX;
  const { x = 0, y, w = 0, h } = b.bounds;
  return earlier.some((e) => x >= (e.bounds.x || 0) - t && y >= e.bounds.y - t
    && x + w <= (e.bounds.x || 0) + (e.bounds.w || 0) + t && y + h <= e.bounds.y + e.bounds.h + t);
}
```

In `extractBlueprint`, before the `out` map, compute `const overlays = []; const flags = kept.map((b) => { const f = isOverlay(b, overlays); if (!f) overlays.push(b); return f; });` and add `overlay: flags[i],` to each output band (after `position`).

`src/fidelity/blueprint-fidelity.js`: `const a = (Array.isArray(original?.bands) ? original.bands : []).filter((b) => !(b && b.overlay));` and the same for `b`.

- [ ] **Step 3: Verify and commit**

`node --test tests/blueprint.test.js tests/blueprint-fidelity.test.js tests/section-roles-source.test.js tests/semantic-output-contract.test.js`

`<scratch>/commit-msg-r2-5.txt`:

```
feat: blueprint marks overlay bands; fidelity aligns without them

The nav and the headline row on the reference page share the hero's
box; the round-one rebuild stacked all three and grew 900 px. Bands
that are pinned, absolutely positioned, or contained in an earlier band
now carry overlay: true, and the blueprint fidelity scorer aligns the
remaining bands so a rebuild that stacks overlays is not scored as
drift.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 6: Strip section text from rawData

**Files:**
- Modify: `src/index.js` (after line 224)
- Modify: `tests/blueprint.test.js` (append)

- [ ] **Step 1: Failing test**

```js
describe('stripBandText also clears landmark section records', () => {
  it('deletes text from section records in place', () => {
    const sections = [{ tag: 'section', text: 'page copy', textLength: 9, bounds: { y: 0, h: 10 } }];
    stripBandText(sections);
    assert.ok(!('text' in sections[0]));
    assert.equal(sections[0].textLength, 9);
  });
});
```

(This passes immediately because the helper is generic; the test pins the intent. Verify RED is therefore skipped by ruling: the wiring in `index.js` has no hermetic test, same as the band strip; see the ledger.)

- [ ] **Step 2: Implement**

`src/index.js`, after the two band strips: the section text has been consumed by `extractVoice` (line 97), `extractPageIntent` (line 211) and `extractSectionRoles` (line 212) by this point.

```js
  stripBandText(rawData.light?.sections || []);
  stripBandText(rawData.dark?.sections || []);
```

Also update the helper's comment in `blueprint.js` to say it serves band and section records.

- [ ] **Step 3: Verify and commit**

`node --test tests/blueprint.test.js tests/semantic-output-contract.test.js tests/v10-features.test.js tests/formatters.test.js`
Expected: pass. If a formatter test reads `sections[].text` from `_raw`, that is the leak this task closes; report it and fix the formatter to read `heading` or `textLength` instead.

`<scratch>/commit-msg-r2-6.txt`:

```
fix: strip landmark section text from rawData after classification

sections[].text carried up to 2000 characters of page copy per landmark
into _raw on every run. It is consumed by voice, page intent and section
roles; it is now deleted right after, in both lanes, with the same
helper the bands use.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 7: Fidelity screenshot lane through the safe proxy

**Files:**
- Modify: `src/fidelity/run.js`, `SECURITY.md`, `README.md`, `bin/design-extract.js` (help text line 2148)
- Modify: `tests/fidelity-loop.test.js` (append)

**Interfaces:**
- `opts.screenshot(url, { allowOrigin?, width, height, channel })` replaces the `(browser, url, opts)` shape. No caller outside `run.js` and its test uses it.

- [ ] **Step 1: Failing test**

```js
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
```

Run `node --test tests/fidelity-loop.test.js`; expected failure: the stub receives `(browser, url, opts)` so `shots[0].url` is a Browser object.

- [ ] **Step 2: Implement**

`src/fidelity/run.js`: import `startSafeBrowsingProxy` from `'../security/safe-proxy.js'`; replace `fullPageShot` with:

```js
// Full-page screenshot through the safe browsing proxy, the same egress
// policy as the crawl. allowOrigin is the fidelity --clone-local allowance
// and is passed for the clone shot only.
async function fullPageShot(url, { width = 1280, height = 800, channel, allowOrigin } = {}) {
  const safeProxy = await startSafeBrowsingProxy(typeof allowOrigin === 'string' ? { allowOrigin } : {});
  let browser;
  try {
    browser = await chromium.launch({
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
```

In `measureCloneFidelity`, remove the shared `chromium.launch` and its `try/finally`; take the shots as:

```js
  const shotOpts = { width: opts.width, height: opts.height, channel: opts.channel };
  const [origShot, cloneShot] = await Promise.all([
    takeScreenshot(originalUrl, shotOpts),
    takeScreenshot(cloneUrl, opts.allowOrigin ? { ...shotOpts, allowOrigin: opts.allowOrigin } : shotOpts),
  ]);
```

Keep whatever the existing code does after the shots (diff, heatmap, visual fidelity) and its error handling for a failed shot; read the surrounding lines before editing. Remove `browserOpts` if nothing else uses it.

Docs: in `SECURITY.md` replace the sentence that says the screenshot lane launches without the safe proxy with one saying the fidelity command's screenshot lane goes through the same safe browsing proxy as the crawl, with `--clone-local` applied to the clone shot only. In `README.md` remove "and the full-page screenshot lane of this command is not proxied". In `bin/design-extract.js` line 2148 drop "; the screenshot lane of this command is not proxied". In `benchmarks/rebuild-round-1.md` leave the caveat (it describes round one).

- [ ] **Step 3: Verify and commit**

`node --test tests/fidelity-loop.test.js tests/cli.test.js tests/loopback-exception.test.js`

`<scratch>/commit-msg-r2-7.txt`:

```
fix: fidelity screenshots go through the safe browsing proxy

The visual lane of the fidelity command launched a browser with no
proxy for both the original and the clone, bypassing the egress policy
the crawl enforces. Each full-page shot now starts its own safe proxy
and browser; the --clone-local allowance reaches the clone shot only.
SECURITY.md, README and the help text drop the caveat.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 8: Placeholder media benchmark gate

**Files:**
- Modify: `src/semantic-benchmark.js` (`scoreBlueprintGates`, scorecard rows), `benchmarks/semantic-bench.mjs` (per-site line adds `placeholders=N`)
- Modify: `tests/semantic-benchmark.test.js` (the `scoreBlueprintGates` describe)

- [ ] **Step 1: Failing test**

In the existing `scoreBlueprintGates` describe, extend the `bp` helper to accept a third argument `mediaSrcs = []` that sets `media: { kind: 'photo', src }` on the first bands, then:

```js
  it('counts sites with a data: placeholder as a band media source', () => {
    const r = scoreBlueprintGates({
      a: bp(['hero', 'content'], 0, ['https://a.test/x.png']),
      b: bp(['hero', 'content'], 0, ['data:image/svg+xml,%3Csvg%3E']),
    });
    assert.equal(r.placeholderMediaSites, 1);
    assert.equal(r.perSite.find((s) => s.id === 'b').placeholderMedia, 1);
  });
```

Update the existing `deepEqual` on site `c` to include `placeholderMedia: 0`. Run `node --test tests/semantic-benchmark.test.js`; expected failure on both.

- [ ] **Step 2: Implement**

`scoreBlueprintGates`: per site add `placeholderMedia: (Array.isArray(bp.bands) ? bp.bands : []).filter((b) => /^data:/i.test((b.media && b.media.src) || '')).length`; in the summary add `placeholderMediaSites: perSite.filter((s) => s.placeholderMedia > 0).length`. Scorecard: after the oversized row add `gateRow('No placeholder media source on any site', score.blueprint.placeholderMediaSites === 0, `${score.blueprint.placeholderMediaSites} sites`, score.blueprint.sites)`. `benchmarks/semantic-bench.mjs` per-site line: append `placeholders=${(bp.bands || []).filter(b => /^data:/i.test(b.media?.src || '')).length}`.

- [ ] **Step 3: Verify and commit**

`node --test tests/semantic-benchmark.test.js`

`<scratch>/commit-msg-r2-8.txt`:

```
feat: benchmark gate for placeholder media sources in blueprint bands

A band whose media source is a data: URI is a lazy placeholder the
collector failed to resolve. The scorecard now fails when any site has
one.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 9: Recapture the reference page and rerun the benchmark

**Files:**
- Output (git-ignored): `benchmarks/results/rebuild-round-2/odyssey-extract/`, `benchmarks/results/blueprint-r2-2026-09-11/`
- Notes: `<scratch>/round-2-notes.md`

- [ ] **Step 1: Recapture** (background, 15-minute timeout, log `<scratch>/odyssey-r2.log`)

`node bin/design-extract.js https://odysseycontracting.com/ --full --screenshots --no-history --out benchmarks/results/rebuild-round-2/odyssey-extract`

- [ ] **Step 2: Check**

Script `<scratch>/check-odyssey-r2.mjs`: read `odysseycontracting-com-blueprint.json` and print per band: index, role, y, h, columns, cardCount, repeats, media kind/src host or `data:`, background color plus inherited, overlay. Expected: 14 to 16 bands; no `media.src` starting with `data:`; the services band role `feature-grid` with `repeats.count 10`; the reviews band media `embed`; bands with null background now `#ffffff` inherited; the nav and headline bands `overlay: true`; the hero band `media.poster: null`. Record every observed value in `<scratch>/round-2-notes.md` together with the wall time from the log and `evidence.capture.scroll` (`node bin/design-extract.js https://odysseycontracting.com/ --json` is not needed; read `extraction`-equivalent fields from the written JSON files). Report misses; do not tune thresholds to hit the numbers.

- [ ] **Step 3: Benchmark** (background, 15-minute timeout, log `<scratch>/bench-r2.log`)

`node benchmarks/semantic-bench.mjs run benchmarks/results/blueprint-r2-2026-09-11 /Users/zero-suminc./projects/tools/third-party/design-extract-hardened/benchmarks/refero-premium-10.json benchmarks/stress-sites-v1.json`
then
`node benchmarks/semantic-bench.mjs score benchmarks/results/blueprint-r2-2026-09-11 benchmarks/semantic-ground-truth-v1.json /Users/zero-suminc./projects/tools/third-party/design-extract-hardened/benchmarks/refero-premium-10.json benchmarks/stress-sites-v1.json`

Compare `scorecard.md` with `benchmarks/results/blueprint-v12-2026-09-11/scorecard.md`: the seven existing rows must be identical; the new row must pass. Read `wallMs` from both `run.json`. If the hero gate or the oversized gate moved, list the sites and the cause (the feature-grid rule or the columns override are the likely movers) before going on; do not revert on your own.

- [ ] **Step 4: Ledger only**

No commit; results are ignored. Write the numbers into `<scratch>/round-2-notes.md`.

---

### Task 10: Rebuild round two

**Files:**
- Create: `benchmarks/rebuild/odyssey-round-2/index.html`, `styles.css`, `app.js`, `BUILD-NOTES.md`

- [ ] **Step 1: Build**

Dispatch a fresh subagent (general-purpose, sonnet) with this prompt verbatim and nothing else:

```
Build a static rebuild of a web page from an extraction directory. Rules, all binding:
- Read ONLY files under benchmarks/results/rebuild-round-2/odyssey-extract/ (JSON, markdown, CSS, and the PNG screenshots, which you may view). Do not open any other file in the repository, do not fetch any URL, do not run a browser, do not search the web. The live site is off limits.
- Output exactly four files in benchmarks/rebuild/odyssey-round-2/: index.html, styles.css, app.js, BUILD-NOTES.md. Vanilla HTML/CSS/JS, no framework, no build step, no CDN scripts. app.js does only two things: reveal-on-scroll with IntersectionObserver for elements marked data-reveal (content must be visible without scrolling; only elements on screen at load may hide-then-fade), and a minimal slider for elements marked data-slider.
- Structure: one <section> per band in odysseycontracting-com-blueprint.json, in order, data-band="<index>" data-role="<role>". A band with overlay: true is positioned on top of the band before it (position absolute inside a relative wrapper, or fixed for a fixed nav) and adds no height. Match every non-overlay band's height within 15%, its columns, its background colour (use background.color; inherited: true means the page surface), and its media kind. A band's repeats field gives the card grid: count, w, h, perRow, withImage, withButton; build exactly that many cards of that size. media.kind embed means an iframe-sized placeholder block of the recorded share with a label. Where the blueprint gives media.src, background.imageUrl, or a video src you may reference the URL as-is; do not download or inline it. A video with media.poster null gets no poster.
- Copy: use heading.text verbatim for that band's largest heading; everything else is placeholder copy of similar length (textLength) that reads as plausible contracting-company copy. Never invent phone numbers, addresses, or prices.
- Tokens: colours, families, sizes, radii, spacing, shadows from odysseycontracting-com-design-tokens.json, -variables.css, -DESIGN.md, -AGENT.md. Load Google families by <link> only if the files name a Google family. Reveal timings from -motion-tokens.json and each band's reveal field.
- Viewport 1280 px wide; no horizontal scroll.
- BUILD-NOTES.md: files read, bands you could not reproduce and why, and every place the extraction did not tell you what you needed.
Report the file sizes and the notes when done.
```

- [ ] **Step 2: Check the build**

Start `node benchmarks/serve-static.mjs benchmarks/rebuild/odyssey-round-2 4174` in the background and run a scratch Playwright script (import playwright from the worktree's `node_modules/playwright/index.mjs` by absolute path) that prints `{ height, horizontalScroll, bands }` and saves a full-page screenshot to `<scratch>/clone-r2.png`. Expected: no horizontal scroll, `bands` equal to the blueprint band count, height within 15 percent of the original's page height (the overlay bands no longer stack). View the screenshot with the Read tool. Fix obvious breakage through the subagent; do not redesign.

- [ ] **Step 3: Commit**

`<scratch>/commit-msg-r2-9.txt`:

```
feat: Odyssey round-two rebuild from the round-two extraction

benchmarks/rebuild/odyssey-round-2: one static page built by Claude from
the recaptured extraction files alone. Overlay bands stack on the band
before them, the services grid is built from the recorded repeats, lazy
image URLs are referenced as given, and the reviews embed is a labelled
block. BUILD-NOTES.md lists what the extraction still did not say.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 11: Measure, report, changelog

**Files:**
- Output (ignored): `benchmarks/results/rebuild-round-2/fidelity/`
- Create: `benchmarks/rebuild-round-2.md`
- Modify: `CHANGELOG.md` (Unreleased section), `README.md` (one line on `repeats` and `overlay` in the blueprint row)

- [ ] **Step 1: Measure**

With the round-two server on port 4174:

`node bin/design-extract.js fidelity https://odysseycontracting.com/ --clone http://127.0.0.1:4174 --clone-local --motion-runtime --out benchmarks/results/rebuild-round-2/fidelity`

Record overall, visual, motion, blueprint scores, `aligned`, `unmatchedBands`, `driftSuspected`, and the per-band rows from `fidelity-blueprint.json`.

- [ ] **Step 2: Report**

`benchmarks/rebuild-round-2.md`, same sections as round one: what ran (commands, commit, wall times), extraction changes with the v12 versus r2 scorecard table (eight rows) and wall time, the blueprint of the reference page (band table with repeats and overlay columns), fidelity (round one beside round two), blueprint comparison per band, what the extraction still misses ranked by score cost, caveats, sources. State the withdrawn round-one items (gesture loader, 25 to 40 bands) and why. No em dashes.

- [ ] **Step 3: Changelog and README**

Under `## [Unreleased]` in `CHANGELOG.md` add an **Added** bullet block: lazy media resolution and `lazyUnresolved`, embed media, `repeats` and the feature-grid rule, inherited backgrounds and `media.poster`, `overlay` bands and the fidelity alignment change, the proxied screenshot lane, the placeholder media gate, the round-two rebuild and report. In `README.md` extend the `*-blueprint.json` table row with "repeats (card grids) and overlay flags".

- [ ] **Step 4: Commit**

`<scratch>/commit-msg-r2-10.txt`:

```
docs: round-two rebuild report, changelog and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

(Write the body with the scores when known: overall, visual, motion, blueprint for round one and round two on one line each.)

---

## Self-review

- Spec coverage: section 1 → Task 1; 2 → Task 2; 3 → Task 3; 4 → Tasks 1 (poster) and 4 (inheritance); 5 → Task 5; 6 → Task 5; 7 → Tasks 6 and 7; 8 → Task 8; 9 → Tasks 9, 10, 11. The spec's "markdown band table" has no counterpart: `markdown.js` renders only the reading-order line, and the blueprint JSON carries `repeats`; no task adds a table.
- Spec deviation, recorded here: Task 1 orders `data-orig-src`/`data-src`/`data-lazy-src` before `data-srcset` (the spec listed `data-srcset` first) so the 1x source wins. Task 6 keeps the helper name `stripBandText` instead of renaming (no churn).
- Type consistency: `repeats` shape `{ count, w, h, perRow, withImage, withButton }` in Tasks 3, 10; `media.poster` in Tasks 1, 10; `background.inherited` in Tasks 4, 10; `overlay` in Tasks 5, 10, 11; `opts.screenshot(url, opts)` in Task 7 only; `placeholderMedia`/`placeholderMediaSites` in Task 8 only.
