# Semantic extraction: evidence and promotion

This document explains the semantic layer added on 2026-09-09: how the extractor separates what it observed from what it promotes as the site's design system, how confidence is derived, how the layer degrades, and how to reproduce the benchmark that gates it.

## The two layers

**Observed.** Everything the crawler measured on rendered elements. It is never filtered by opinion. Examples: every corner radius including `0px` and `50%` (`borders.observed`), every font family that appeared as a computed value (`typography.system.acceptedFamilies` plus `rejectedFamilies` with reasons), every image, CSS background, video poster, and sizeable canvas (`imageryStyle.dominantMedia`).

**Promoted.** The values the extractor is willing to call the system, each carried as a decision with `value`, `confidence`, `coverage`, `reasons`, and `alternatives`. A promoted value always has an observed record behind it. A rejected value stays in the observed layer with the reason it was rejected.

The public output keeps every pre-existing field. `borders.radii` is still positive pixels only, `typography.families` keeps its shape, and `imageryStyle.label` keeps its name. New fields are additive: `design.evidence`, `typography.system.bodyFamily` and `headingFamily`, `borders.geometry`, `borders.observed`, `imageryStyle.distribution`, `dominantMedia`, `coverage`, `alternatives`, and `materialLanguage.metrics.pillSignal`.

## What the collector changed

The in-page collector (`collectPageData` in `src/crawler.js`) now:

- Skips non-rendered nodes before they consume the element budget: anything inside `head`, and `script`, `style`, `link`, `meta`, `template`, `noscript`, `source`, `track`, `title`, `base`. SVG internals are skipped; the `svg` root is kept. A total-visit cap of ten times the element budget bounds the scan on hostile pages.
- Reads images as `currentSrc`, then `src`, then the first `srcset` candidate. Lazy and responsive images used to report an empty source.
- Records CSS `background-image` URLs, `video` posters, and canvases of at least 10,000 px² as `backgroundMedia`, with position and size. Nothing is fetched; no pixels are read.

Every string stored from the page is capped at 500 characters. No HTML, font bytes, image bytes, or page text are persisted.

## Fonts

A family is promoted only when it has provenance beyond the computed string and it paints visible text:

- Provenance: a `document.fonts` entry with status `loaded`, an `@font-face` rule, or a Google Fonts link. A computed family with none of these never rendered; the browser drew a fallback.
- Visible use: at least one element with direct text, and either a heading, ten text elements, or one percent of the page's text elements. Smaller families (a cookie widget's font, one fallback field) are observed but not promoted.
- OS faces such as Arial, Helvetica, or Times need ten percent of visible text or a site declaration.
- Generic families, icon fonts (known libraries and any name containing `icon`), declaration-shaped strings such as `object-fit: contain`, control characters, and over-long values are rejected with a reason.

`bodyFamily` is the plurality among accepted families on body tags; `headingFamily` among `h1` to `h3`.

## Geometry

Each rendered element's `border-radius` shorthand is expanded to four corners with its unit. Percent values stay percent. An element votes only when it paints a box (a fill, a border, a shadow, or a background image), has a non-zero size, and is not an inline text tag carrying a control class (the label inside a button is not the button).

Per element: all corners at or below 2px is `square`; a corner at or above half the short side, or 50%, or 100px, is `pill` (`circle` when the box is square and the role is avatar or media); everything else is `rounded`.

`byRole` groups votes by inferred owner (button, input, card, navigation, section, media, avatar, badge, decorative, text, unknown). `global` is a vote across the control roles only (button, input, card), with each role voting by its share rather than its element count, so a grid of cards cannot drown the buttons. Avatars, badges, and decorative dots never move `global`. Page containers (navigation, section) speak only when a page has no control evidence at all. A margin under 15 points yields `mixed`.

`materialLanguage` reads the pill signal from `borders.geometry` when present and reports `metrics.geometrySource` as `role-aware`; without geometry it falls back to the legacy numeric scan.

## Media

Every image, CSS background, video poster, and canvas is a candidate weighted by `width × height × viewport fraction × opacity`. Hidden candidates weigh zero. Icon-sized candidates (short side under 48px or area under 2,500 px²) leave the denominator unless nothing else exists. Non-SVG `data:` URIs are blur-up placeholders and do not vote; `url(#id)` references are SVG paint servers and do not vote.

Classification is deterministic and refuses to guess:

- SVG is illustration or iconography by size.
- `jpg`, `jpeg`, `webp`, `avif` are photography, or product photography with `object-fit: contain` or product hints.
- The original extension is recovered from image-proxy URLs (`/_next/image?url=…` and similar) before classifying.
- A `png` without a screenshot or illustration hint is `unknown` with the signal `png-ambiguous`. Extensionless sources are `unknown` with `extensionless-source`. Canvases are `unknown` with `canvas-rendered`. Posters follow their own extension.

`label` is the top class when its share is at least 50% with a 15-point margin; photography and product photography count as one family for that margin. An unknown share over 50% makes the label `unknown`. Confidence is the top share scaled by classified coverage and never depends on how many images a page has.

### Pixel lane

Candidates the DOM leaves `unknown` get a second look from their pixels (`src/pixel-lane.js`, `src/extractors/pixel-features.js`, on by default, `pixelEvidence: false` turns it off). The rules that keep it inside the crawler's safety model:

- Bytes come only from responses the page itself made. A ledger on the Playwright page records `image/*` bodies (SVG excluded) as Chromium receives them through the safe proxy. No image URL is ever fetched a second time.
- The ledger is bounded (300 entries, 8 MB per image, 64 MB total) and cleared before the crawl returns. Only numbers leave: a feature record per candidate and a label.
- At most 8 candidates are analysed (largest visible rasters, long side ≥ 300 px). A canvas, or an image whose own pixels are a transparent glow or mask layer, is read from a composited element screenshot instead (at most 3, 5 s each).
- Sharp is loaded lazily; if the native module is missing the lane reports `pixel lane unavailable: …` in `evidence.warnings` and the DOM result stands.

Classification uses entropy bands measured on the benchmark corpus (`benchmarks/pixel-bakeoff-2026-09-10.md`): photographs at entropy ≥ 6.2, renders and screenshots below 5.0, `unknown` in between. A pixel label never overrides a DOM label, because a product render on a white sweep reads as flat pixels but is product photography to the DOM. Resolved candidates carry `pixel: { label, confidence, source }` in `dominantMedia`, keep their DOM signal (`png-ambiguous`, `extensionless-source`, `canvas-rendered`), and add the pixel signal that decided them.

## Fallback and failure

Promoters run one at a time under a guard. A failing promoter leaves every inventory intact and appends a named entry to `evidence.warnings`, for example `geometry promoter failed: …`. The old count-based imagery path still serves inputs without layout evidence (older captures, tests).

`evidence.collector` is `dom`. The CDP snapshot adapter proposed in the original plan was not needed for any benchmark failure and is not implemented; see the plan for the reopen conditions.

## Reproducing the benchmark

Inputs:

- `benchmarks/refero-premium-10.json`: the ten Refero-annotated sites (annotations are context, never truth).
- `benchmarks/stress-sites-v1.json`: six sites chosen for specific failure modes, with the candidates that were rejected and why.
- `benchmarks/semantic-ground-truth-v1.json`: labels for all sixteen sites at 1280×800, produced by two independent labelers and a reconciler from screenshots and DOM evidence, `reviewer: agent-pending-human`. Disagreements are recorded in each site's notes.

Scoring uses `loadSemanticGroundTruth`, `scoreSemanticExtraction`, and `formatSemanticScorecard` from `src/semantic-benchmark.js`. Every ratio is printed with its numerator and denominator. Only sites with `captureStatus: reviewed` are scored; a site with no extraction is listed as unscored.

Gates: zero declaration-shaped families promoted, font recall at least 0.95, square systems survive with zero incidental flips, media top-two recall at least 0.90, photography false positives under 0.05, and semantic processing adding less than 20% wall time over the same crawl.

## Measured result (2026-09-09)

Full numbers and per-site detail: `benchmarks/semantic-scorecard-2026-09-09.md`.

| Gate | Result | Status |
|---|---|---|
| Declaration-shaped families promoted | 0 (was `object-fit: contain` on Woven) | PASS |
| Font recall | 43/43 | PASS |
| Font precision | 2/45 promoted names disputed by labelers, both with loaded provenance and visible text | FAIL on count, disputed |
| Square systems survive, incidental flips | Woven and SwimClub read `square`; flips 0/16 | PASS |
| Media top-two recall | 10/16 DOM only; 15/16 with the pixel lane (2026-09-10) | PASS |
| Photography false positives | 0/16 | PASS |
| Semantic processing cost | promoters 9–24 ms per page; pixel lane under 1 s, bounded at 10 s | PASS |

The six DOM-only media misses were the ceiling the plan named: two PNG heroes, two extensionless image CDNs, one WebGL canvas, one age gate. The pixel lane (`benchmarks/pixel-bakeoff-2026-09-10.md`) resolves the five that pixels can decide from bytes the page itself loaded; the age gate remains, and needs interaction. Deterministic rules were not stretched: a case pixels cannot decide still returns `unknown` with a signal naming the reason.

## Reading disagreement with Refero

Refero describes a site from its own capture on an unknown date. The extractor describes the live page at capture time. When they differ, check the capture first: an age gate (Woven), a redesign, or a cookie wall changes what was measurable. Then check the evidence records, which say why a value was promoted or rejected. A confident extractor value with a cited reason beats an annotation; an `unknown` with a signal is the extractor saying the DOM alone cannot decide.
