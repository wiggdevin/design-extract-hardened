# Semantic scorecard, 2026-09-09

Corpus: 10 Refero sites plus 6 stress sites, 1280×800, three workers, `wait: 1500`. Ground truth: `semantic-ground-truth-v1.json` (two independent agent labelers plus a reconciler per site; pending human review). Scorer: `src/semantic-benchmark.js`. Raw counts are printed with every ratio.

## Gates

| Gate | Before (prior extractor, scored on the same truth) | v1 (slices 0–4 as implemented) | v4 (DOM only, after live-site and review fixes) | v5 (v4 + pixel lane, 2026-09-10) | Status |
|---|---|---|---|---|---|
| Font precision: declaration-shaped or rejected families promoted | `object-fit: contain` promoted on Woven; `Times` on 7 sites | 7/53 | 2/45 | 2/45 | FAIL on count, see disputes |
| Font recall ≥ 0.95 | not measurable (no rejected list) | 43/43 | 43/43 | 43/43 | PASS |
| Geometry: square systems survive, incidental flips = 0 | Woven `[50]`, SwimClub `[8, 26]`: square invisible | flips 0, global 6/16 | flips 0, global 7/16, button role 11/16 | unchanged | PASS on the gate |
| Media top-two recall ≥ 0.90 | Filling Pieces `mixed` with 0 photos among 249 images | 12/16 | 10/16 | 15/16 | PASS |
| Photography false positives < 0.05 | n/a | 1/16 (Linear) | 0/16 | 0/16 | PASS |
| Runtime: semantic processing < 20% of crawl | 50 s wall for 10 sites at 3 workers | n/a | 85 s wall for 16 sites at 3 workers; promoters 9–24 ms per page (< 0.5%) | 90 s wall for 16 sites; pixel lane ≤ 1.7 s on a page with a stalled image body, well under 1 s otherwise | PASS |

v1 to v4 traded media recall for honesty: v1 called Linear and N26 photography from extensionless URLs and called Aevi and SwimClub screenshots from large PNGs. v4 says `unknown` with a signal in all four cases. v5 adds the pixel lane (`benchmarks/pixel-bakeoff-2026-09-10.md`): the same five sites are now labeled from the pixels of images the page itself loaded, and every other gate is unchanged. The only remaining media miss is Woven's age gate. Sections below are from the v4 run (`benchmarks/results/semantic-v4-2026-09-09`, not tracked); the v5 run is in `semantic-v5-2026-09-10`.

## Font precision disputes (v4)

| Site | Promoted | Evidence | Labelers |
|---|---|---|---|
| Aevi Wellness | Secondary Font | loaded, `@font-face`, 10 text elements of 433 | rejected |
| Opus One Winery | fira_sans-ultralight | loaded, `@font-face`, used on a heading | rejected |

Both carry provenance and paint visible text. The extractor's rule is defensible; the labels may be wrong. Left for human review.

## Media misses (v4)

| Site | Truth | Extractor | Why the DOM cannot decide |
|---|---|---|---|
| Woven | product-photography, photography | unknown | age-gate overlay at capture; only the gate logo is on screen |
| Aevi Wellness | photography, product-photography | unknown (`png-ambiguous`) | hero is a 789,760 px² PNG |
| SwimClub | product-photography, photography | unknown (`png-ambiguous`) | hero is an 879,360 px² PNG |
| N26 | photography | unknown (`extensionless-source`) | Bynder `transform/<id>/<name>` URLs, no extension |
| Hyper Foundation | ui-screenshot, 3d-render | unknown (`poster-ambiguous`) | video poster is a PNG |
| Spline | 3d-render, ui-screenshot | unknown (`canvas-rendered`) | WebGL canvases, no raster media |

Five of six need pixel inspection; one needs interaction (age gate). This was the measured condition the plan set for reopening the Sharp and SigLIP lane. In v5 the pixel lane resolves all five: Aevi photography 82%, SwimClub photography 100%, N26 photography 99%, Hyper Foundation `ui-screenshot` 43% in the top two (page label stays `unknown` because four small logos hold 56% of the weight), Linear ui-screenshot 100%, Spline 3d-render 100%. SigLIP was not needed.

## Geometry (v4)

Button role: 11/16. Misses: Aevi (15/27 pill, margin under 15 points, reported `mixed`), Emma Lewisham (painted buttons above 2px, reported `rounded`), N26 (four pill, four rounded, `mixed`), Hyper Foundation (no painted button found), Spline (4/4 rounded; the probe also read rounded, the label says pill).

Global: 7/16. The labelers themselves split on the same pattern: pill buttons with rounded cards were labeled `pill` for Apple, Wise, and Linear and `mixed` for Monzo, Mercury, and Spline. The extractor reports `mixed` for that pattern and shows both roles.

## Per-site (v4)

| Site | Body family | Rejected (top) | Geometry global / button | Imagery |
|---|---|---|---|---|
| Apple – MacBook Neo | SF Pro Text | Arial, Times | mixed / pill | product-photography 61% |
| Woven | Spezia Semi-Mono Regular | Times, GTStandard-M, object-fit: contain | square / square | unknown (age gate) |
| Aevi Wellness | Primary Font | Arial, Josefin Sans | square / mixed | unknown (png) |
| SwimClub | Apercu Mono Pro | Apple Color Emoji, Lora, Times, GTStandard-M | square / square | unknown (png) |
| Filling Pieces | favorit | Apple Color Emoji, GTStandard-M, Times, Arial | rounded / rounded | product-photography 52%, photography 45% |
| Emma Lewisham | Martina Plantijn | Times, Arial, avenir next, GTStandard-M | mixed / rounded | product-photography 93% |
| N26 | N26 | – | mixed / mixed | unknown (extensionless) |
| Hyper Foundation | ABC Diatype Regular | Times, sans-serif | null / – | unknown (poster png) |
| Origin Financial | Inter | sans-serif | rounded / rounded | photography 90% |
| Mercury | arcadia | Apple Color Emoji | pill / pill | photography 100% |
| Opus One Winery | fira_sans-book | – | square / square | photography 99% |
| Auberge Resorts | CentraNo1 Book | aurberge-icons, Lato, sans-serif | square / square | photography 100% |
| Linear | Inter Variable | – | mixed / pill | unknown 84%, ui-screenshot 16% |
| Spline | Spline Sans | Times, SFMono-Regular | rounded / rounded | unknown (canvas) |
| Wise | Inter | monospace, sans-serif | pill / pill | photography 100% |
| Monzo | MonzoSansText | – | pill / pill | photography 98% |

## Reproduce

```bash
node benchmarks/semantic-bench.mjs run   benchmarks/results/<name>
node benchmarks/semantic-bench.mjs score benchmarks/results/<name> benchmarks/semantic-ground-truth-v1.json
```

Both modes read `benchmarks/refero-premium-10.json` and `benchmarks/stress-sites-v1.json` by default; pass other manifest paths as trailing arguments. `score` uses the exported scorer from `src/semantic-benchmark.js`. Results directories are ignored by git.
