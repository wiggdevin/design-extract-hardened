# Pixel lane bakeoff, 2026-09-10

Question: can bounded pixel statistics (Sharp) resolve the media candidates the DOM leaves `unknown`, without a classifier model? The v4 scorecard set the condition: six sites missed media top-two recall, five of them because a PNG hero, an extensionless CDN image, a PNG video poster, or a WebGL canvas cannot be labeled from markup.

## Method

- Corpus: the same 16 sites (10 Refero, 6 stress), 1280×800, ground truth `semantic-ground-truth-v1.json`.
- Input: for each site, the top five `imageryStyle.dominantMedia` entries from the v4 run. Bytes come from the page's own responses (a response ledger on the Playwright page, image/* only, no SVG). No image URL is fetched that the page did not fetch. A canvas, or an image whose decoded pixels are a mostly transparent layer, falls back to a composited element screenshot.
- Features (`src/extractors/pixel-features.js`), computed on a 192 px working copy: entropy, sharpness, luminance stdev, exact unique-color ratio, flat-neighbour share, top-8 quantized color share, strong-edge density, axis-aligned edge share, mean saturation, transparent share.
- Script: `node benchmarks/pixel-bakeoff.mjs capture|features|score`. Crops and viewport shots were written to the session scratchpad only; nothing under `benchmarks/` holds image bytes.

## What the first two captures taught

1. Composited element screenshots are not the image. The Apple hero crop carried the headline and white margins, an Emma Lewisham slot was blank (lazy), the N26 crop had the cookie banner over the hero. Every known photograph scored as "flat".
2. A size-only element match picks the wrong element. Four Emma thumbnails matched a 10×7 blur-up placeholder. Matching is now by source only; a canvas is the one kind matched by its box.
3. Linear's two largest images are glow and mask layers with mean alpha 13 and 102 of 255. Their own pixels say nothing; the composited element is what the page shows. Transparent layers now fall back to the composited crop.

## Feature bands (43 crops, third capture)

| Class (by truth and DOM label) | Entropy | Unique-color ratio | Flat share |
|---|---|---|---|
| Photographs (28 crops: Aevi, SwimClub, N26, Filling Pieces, Emma, Mercury, Opus One, Auberge, Wise, Monzo) | 6.25 to 7.85 | 0.09 to 0.99 | 0.04 to 0.71 |
| Renders, screenshots, logos (Linear, Hyper poster, Spline canvas, Apple frames, Monzo art, Woven gate logo) | 0.25 to 4.8 | 0.02 to 0.37 | 0.60 to 0.97 |
| Gradient hero (Origin css-background) | 5.9 | 0.39 | 0.61 |

Entropy alone separates the two classes on this corpus with a gap from 4.8 to 6.25. Thresholds: photograph at entropy ≥ 6.2 and unique ratio ≥ 0.08; render at entropy < 5.0 and flat share ≥ 0.6, then canvas → `3d-render`, transparent ≥ 20% → `illustration`, axis-aligned edges ≥ 60% with edge density ≥ 3% → `ui-screenshot`, else `illustration`. Between the bands: `unknown` with signal `pixel-ambiguous`. Boxes under 300 px on their long side stay `unknown` (`pixel-small`).

Known limit: a product render on a white sweep (Apple's hero frames, entropy 2.1) reads as flat. Pixel labels therefore only resolve candidates the DOM left `unknown`; a DOM label is never overridden.

## Result (bakeoff scorer, v4 distributions relabeled)

| Site | Truth | Before | After | Moved by pixels |
|---|---|---|---|---|
| Aevi Wellness | photography, product-photography | unknown | photography 95% | 2 img → photography |
| SwimClub | product-photography, photography | unknown | photography 100% | img → photography |
| N26 | photography | unknown | photography 99% | img → photography |
| Hyper Foundation | ui-screenshot, 3d-render | unknown | unknown 56%, ui-screenshot 43% | video-poster → ui-screenshot |
| Linear | ui-screenshot, 3d-render | unknown | ui-screenshot 100% | 2 img → ui-screenshot |
| Spline | 3d-render, ui-screenshot | unknown | 3d-render 100% | canvas → 3d-render |
| Woven | product-photography, photography | unknown | unknown | nothing: age gate, hero never loads |
| other 9 | | unchanged | unchanged | none |

Media top-two recall 15/16 (was 10/16). Photography false positives 0/16. The remaining miss needs interaction (dismiss the age gate), not pixels. Hyper's page label stays `unknown` because four small PNG logos (196×32) hold 56% of the weight and are below the decisive size; the poster is correctly `ui-screenshot` and reaches the top two.

SigLIP was not run. The doc's plan was to bake it off only on crops Sharp leaves ambiguous; after the size floor no decisive crop landed in the ambiguous band, so there was nothing for it to resolve on this corpus. Transformers.js and ONNX Runtime were not added.

## Pipeline run (v5, lane wired into the crawler)

See `semantic-scorecard-2026-09-09.md`, column v5, for the same corpus through `extractDesignLanguage` with the lane on by default (`pixelEvidence: false` turns it off). The first pipeline run stalled on emmalewisham.co.uk: one image response body never finished and the ledger waited for it. The wait is now bounded (1.5 s) and the lane has a 10 s budget; the site completes in 35 s with the lane costing 1.7 s.

## Review findings (three lenses, adversarially verified)

Fixed: the join key between a candidate and its evidence could collide for two same-size canvases or two CDN URLs sharing a 120-character prefix (one verdict cloned onto an unanalysed candidate); the key now carries source, box, and position and is one shared function. The `data-designlang-pixel` marker was left in the DOM when a screenshot failed; cleanup is now in `finally`. Byte caps were applied only after a whole body was buffered; a `content-length` pre-check now refuses oversized images first (chunked responses without a length are still read then dropped). Tests were added for the composited fallback and its cap, the transparent-layer fallback, the stalled-body wait, and the time budget.

Not fixed: the `evidence.warnings` entry for a missing Sharp module (`src/index.js`) has no unit test, because `extractDesignLanguage` has no seam to inject crawl output. The branch is two lines and was read by two reviewers.

## Reproduce

```bash
node benchmarks/pixel-bakeoff.mjs capture  benchmarks/results/semantic-v4-2026-09-09 <scratch>/pixel-bakeoff
node benchmarks/pixel-bakeoff.mjs features <scratch>/pixel-bakeoff
node benchmarks/pixel-bakeoff.mjs score    <scratch>/pixel-bakeoff benchmarks/results/semantic-v4-2026-09-09 benchmarks/semantic-ground-truth-v1.json
```

Pass the Refero manifest path as a trailing argument when it is not in `benchmarks/`.
