# Section blueprint and the rebuild loop

**Date:** 2026-09-11
**Status:** Approved design, round one
**Branch:** `worktree-blueprint-loop`, stacked on `worktree-semantic-evidence` (PR #6)
**Reference site for round one:** https://odysseycontracting.com/

## Goal

Make the extraction good enough that a builder with no access to the live site can rebuild the page from the extraction files alone, and measure how close it gets. Round one rebuilds one reference site to find what the extraction misses. Later rounds build new sites in the same key.

## What round one produces

1. Extractor changes on this branch, each with a unit test on recaptured page records, and a rerun of the 16-site semantic benchmark showing the font, geometry, and media gates unchanged.
2. A rebuild of the Odyssey Contracting homepage as one static page, built from the extraction directory only.
3. Two scores of that rebuild against the live page: the existing fidelity score (pixels plus motion, with a ranked correction plan) and a new blueprint comparison (did the extraction describe the page correctly).
4. A report that lists what the extraction still misses, ranked by what it cost in the scores.

Done means all four exist and the benchmark gates hold.

## Evidence this design rests on

Measured on the full extraction of the reference page (`--full --screenshots`, 297 s):

- The page has 57 full-width bands (`fusion-fullwidth`), 17 reveal animations (`fusion-animated`), 3 Lottie players, Swiper sliders, and images that load only when they enter the viewport (`lazyload` class, `data-lazy-src`, column background images). The page is 20,564 px tall at 1280 wide.
- The scroll pass in `runInteractionPass` (`src/crawler.js:404`) scrolls in four quarter-page steps with a 300 ms wait each, then returns to the top. The runtime motion pass (`captureRuntimeMotion`, `src/crawler.js:523`) does the same with 220 ms. On this page each step jumps about 5,000 px, so the lazy loader and the reveal observers fire for almost nothing. The capture shows blank service cards, a blank reviews band, and a black hero video box, and imagery reads as "illustration 100%" from the logo alone.
- Sections are collected from landmark tags only (`header, nav, main, section, footer, aside` and ARIA equivalents, `src/crawler.js:1165`). The page has two `section` tags. The whole `main` was classified "comparison" because its text contains "vs", and nine menu wrappers were classified "nav". `sectionRoles.readingOrder` came back as nine nav entries, two whole-page comparisons, one content, one footer. `src/clone.js` builds its page from this order.
- Section bounds are viewport-relative at capture time, so a page captured after scrolling reports negative `y` values (seen on Apple: `-781`).
- The agent brief (`src/formatters/agent-prompt.js`) prints families, CTA verbs, and anatomy variants as `[object Object]`. The formatter reads `f.name` and `c.value`, which match the raw extraction; the brief formats the projected copy from `src/security/prompt-data.js`, so the projected shape differs from the raw shape. Fix in the formatter after reading the projection.
- Page intent came back `landing` at 0.29 with `legal` as the runner-up.
- The URL guard (`src/security/url-safety.js`) refuses local hostnames and any port other than 80 or 443. The safe proxy (`src/security/safe-proxy.js`) resolves every destination through `resolvePublicTarget`, which refuses loopback. `designlang fidelity <original> --clone http://localhost:3000` cannot crawl the clone in this fork.

Tokens are correct: navy, amber, and terracotta palette; Adero headings with Kumbh Sans body; radii 5, 10, 20, 50; cream and navy section bands.

## Design

### 1. Capture: scroll by viewport, wait for images

One shared scroller replaces the two four-step loops.

- Step by the viewport height (800 px at the default viewport), settle 150 ms per step, then `networkidle` with a 1 s cap. Steps are capped at 60 (48,000 px); a taller page is scanned to the cap and `evidence.capture.scroll` records `{ steps, coveredPx, pageHeightPx, capped }`.
- After the pass, wait up to 3 s for every `img` inside the document to report `complete`, then return to the top and settle 200 ms.
- The runtime motion pass reads `document.getAnimations()` at each step, as today, so CSS reveals triggered by intersection are seen in flight.
- Budget: on the reference page this is 26 steps, about 8 s. The 16-site benchmark records the wall-time delta; the existing gate (semantic processing under 20 percent of crawl time) stays.

Motion stack detection is a new pure function `detectMotionStack({ scripts, windowGlobals, tagSample, classSample })` in `src/extractors/motion-runtime.js`. It names Lottie, Swiper, GSAP, ScrollTrigger, Lenis, Locomotive, AOS, Framer Motion, and Motion One from script sources, window globals, element tags (`lottie-player`), and class prefixes (`swiper-`, `aos-`, `fusion-animated`). The collector adds `lottie-player`, `canvas`, and `video` counts and a class sample to `results.stack`. Output: `motion.stack: [{ name, evidence, count }]`. A Lottie canvas stays unreadable; the field says it exists and where.

### 2. Section blueprint

A new extractor `src/extractors/blueprint.js` with a matching collector step.

**Collector** (`collectPageData`, new `results.bands`): walk the children of `body` and of `main` when present, descending through wrappers that hold one child of the same size. Keep elements whose box is at least 90 percent of the viewport width and at least 120 px tall. When a kept element contains another kept element, keep the outermost. Sort by document `y` (`rect.y + window.scrollY`), cap at 40. For each band record:

- `bounds` in document coordinates
- `background`: `{ color, imageUrl | null, hasVideo }` from the band and its first painted descendant that covers at least 80 percent of the band
- `columns`: the number of equal-width children (within 10 percent) in the widest child row that has two or more children, else 1
- `media`: dominant kind by area among `img`, `video`, `svg`, `canvas`, and background images: `photo | video | svg | canvas | none`, with the source URL of the largest
- `heading`: `{ level, fontSize, text }` for the largest heading in the band; text capped at 120 characters and subject to the same projection rules as everything else
- `textLength`, `buttonCount`, `cardCount` (reuse the section rules)
- `tag`, `role`, `className`, `id`

**Extractor** (`extractBlueprint(bands, runtimeMotionObs, pageIntent)`):

- Attaches `reveal: { kind, durationMs, easing } | null` to each band from runtime observations whose target path falls inside the band's box at the step it was observed.
- Classifies each band with `classifyRole` from `src/extractors/section-roles.js`, with three rule changes there:
  - a band taller than 80 percent of the page height is skipped, never classified;
  - `nav` applies only to `nav` and `header` tags or `role=navigation|banner`, and only when the band's top is within 200 px of the page top or the element is fixed or sticky;
  - `hero` is the first band whose media covers at least 40 percent of the band, or whose largest heading is at least 40 px, and which starts within 1.5 viewport heights of the top.
- Returns `{ bands: [...], readingOrder: [...roles], counts }`.

**Wiring**: `design.blueprint` is added, `<host>-blueprint.json` is written, and `sectionRoles.readingOrder` is derived from the blueprint when bands exist. `src/clone.js` and `src/formatters/prompt-pack.js` read `sectionRoles` as today and improve without changes. `regions` keeps its shape; its `bounds.y` is corrected to document coordinates.

**Bounds**: `results.sections` and `results.bands` both record `y` as `rect.y + window.scrollY`.

### 3. Brief fixes

`src/formatters/agent-prompt.js`: format families, CTA verbs, variants, and slots by the projected shape. Title and source stay as the projection allows.

### 4. Build protocol

The builder is Claude in a session with these rules:

- Inputs: the extraction directory only (JSON, markdown, screenshots). No live-site access, no page source, no search.
- Output: one static page: `index.html`, one CSS file, one small vanilla JS file for reveals and the slider. No framework, no build step.
- Images: the page may reference the source image URLs recorded in the extraction (`dominantMedia`, band `media.src`, `images`) so composition can be scored. The extraction stores no image bytes; this rule does not change that.
- Copy: the projection strips page copy, so headline text comes from the band `heading.text` field where the projection allows it and is otherwise placeholder text of the same length.
- Served from `127.0.0.1` on a fixed port by a static server started for the measurement.

### 5. Measurement

**Fidelity** (existing): `designlang fidelity https://odysseycontracting.com/ --clone http://127.0.0.1:<port> --clone-local`. Pixel diff of full-page screenshots plus motion fidelity, one score, letter grade, ranked correction plan.

**Blueprint comparison** (new, `src/fidelity/blueprint-fidelity.js`, `scoreBlueprintFidelity(original, clone)`): bands are aligned in order. For each aligned pair, five checks: role equal, background color within an OKLab distance of 0.08 or both image or both video, column count equal, media kind equal, height within 15 percent. Score is matched checks over total checks across the shorter band list, with a penalty of one full band for each unmatched band on either side. Reported per band so the report can say which band the extraction got wrong. This number separates "the extractor missed it" from "the builder built it wrong": a band the blueprint describes correctly but the build renders wrong is a build fault; a band the blueprint describes wrong is an extraction fault.

**Loopback exception**: a new option `--clone-local` on the `fidelity` command only. It accepts a clone URL whose host is `127.0.0.1` or `localhost` with any port and passes `{ allowOrigin: 'http://127.0.0.1:<port>' }` down `measureCloneFidelity` to `extractDesignLanguage` to `crawlPage` to `startSafeBrowsingProxy`. The proxy permits exactly that origin without `resolvePublicTarget` and refuses every other loopback or private destination as before. `validateTargetUrl` gains the same single-origin allowance behind the same option. The option does not exist on the extraction command, `clone`, `pack`, or the MCP server. Tests: the allowed origin passes; a different port, a different loopback address, a private IPv4, and a redirect from the allowed origin to a private address are all refused.

### 6. Tests and gates

- Unit tests on recaptured records of the reference page (as the geometry fix did): the band walker finds the hero band first and a services band with two columns and photo media; the whole-page container is never classified; the nine menu wrappers yield at most one nav; images marked `complete` after the pass.
- Motion stack: Lottie, Swiper, and `fusion-animated` detected on the reference records; none detected on a record with no such signals.
- Blueprint fidelity: identical blueprints score 1; a missing band costs one band; a column mismatch costs one check.
- Loopback: the four refusal cases above.
- Benchmark: the 16 sites rerun. Existing gates unchanged. One new gate: a hero found at the top on at least 14 of 16 sites and no band taller than 80 percent of the page on any site.

### 7. Report

`benchmarks/rebuild-round-1.md`: extraction changes and their benchmark effect, the fidelity score and correction plan, the blueprint comparison per band, and the ranked list of what the extraction still misses. This list is the input to round two.

## Out of scope for round one

- Building a new site in the reference's key (phase two).
- Reading Lottie or canvas content.
- Hover and cursor effects.
- Multi-page blueprints.
- Any change to what the extraction persists: still no HTML, image bytes, font bytes, cookies, or headers.

## Preserved

The safe proxy, redirect and IP validation, the remote-browser prohibition, browser argument filtering, and collection budgets stay as they are except for the single-origin allowance described in section 5, which is opt-in on one command and tested to refuse everything else.
