# Semantic scorecard, 2026-09-09

Corpus: 10 Refero sites plus 6 stress sites, 1280×800, three workers, `wait: 1500`. Ground truth: `semantic-ground-truth-v1.json`. The columns in the gates table were scored on the agent labels (two independent agent labelers plus a reconciler per site). The file has since been human-reviewed; the scores on that truth are in "Human review" below. Scorer: `src/semantic-benchmark.js`. Raw counts are printed with every ratio.

## Gates

| Gate | Before (prior extractor, scored on the same truth) | v1 (slices 0–4 as implemented) | v4 (DOM only, after live-site and review fixes) | v5 (v4 + pixel lane, 2026-09-10) | v6 (v5 + consent step, 2026-09-10) | Status |
|---|---|---|---|---|---|---|
| Font precision: declaration-shaped or rejected families promoted | `object-fit: contain` promoted on Woven; `Times` on 7 sites | 7/53 | 2/45 | 2/45 | 2/45 | FAIL on count, see disputes |
| Font recall ≥ 0.95 | not measurable (no rejected list) | 43/43 | 43/43 | 43/43 | 43/43 | PASS |
| Geometry: square systems survive, incidental flips = 0 | Woven `[50]`, SwimClub `[8, 26]`: square invisible | flips 0, global 6/16 | flips 0, global 7/16, button role 11/16 | unchanged | scored 28/61 (was 27/61); flips 1 on Emma Lewisham, whose truth label cites the cookie banner's own buttons, see the consent note | PASS on the gate before the consent step; the one flip is a truth-label question for the human review |
| Media top-two recall ≥ 0.90 | Filling Pieces `mixed` with 0 photos among 249 images | 12/16 | 10/16 | 15/16 | 15/16 | PASS |
| Photography false positives < 0.05 | n/a | 1/16 (Linear) | 0/16 | 0/16 | 0/16 | PASS |
| Runtime: semantic processing < 20% of crawl | 50 s wall for 10 sites at 3 workers | n/a | 85 s wall for 16 sites at 3 workers; promoters 9–24 ms per page (< 0.5%) | 90 s wall for 16 sites; pixel lane ≤ 1.7 s on a page with a stalled image body, well under 1 s otherwise | 90 s wall for 16 sites | PASS |

v1 to v4 traded media recall for honesty: v1 called Linear and N26 photography from extensionless URLs and called Aevi and SwimClub screenshots from large PNGs. v4 says `unknown` with a signal in all four cases. v5 adds the pixel lane (`benchmarks/pixel-bakeoff-2026-09-10.md`): the same five sites are now labeled from the pixels of images the page itself loaded, and every other gate is unchanged. The only remaining media miss is Woven's age gate. Sections below are from the v4 run (`benchmarks/results/semantic-v4-2026-09-09`, not tracked); the v5 run is in `semantic-v5-2026-09-10`, the v6 run in `semantic-v6-2026-09-10`.

### Consent step (v6)

A cookie card was in the capture on 6 of 16 sites. v6 refuses or hides it before anything is measured (`src/consent.js`, `docs/semantic-extraction.md` "Consent banners"). Recorded in `evidence.capture.consent`:

| Site | Tool | Action |
|---|---|---|
| N26 | custom, inside a shadow root | rejected |
| Emma Lewisham | CookieYes | rejected, scroll lock released |
| Opus One Winery | OneTrust | rejected |
| Monzo | custom dialog | rejected |
| Auberge Resorts | OneTrust, no refusal control | hidden |
| Filling Pieces | Cookieconsent | hidden, scroll lock released |

Woven's age gate is detected and deliberately left alone (`ignored: age-gate`). Three geometry verdicts moved once the banner's own buttons stopped counting: N26 `mixed` to `pill` (truth pill, now correct), Emma Lewisham `mixed` to `rounded`, and Filling Pieces `mixed` to `rounded`. The Emma and Filling Pieces truth labels were made on captures that still had the banner, and Emma's evidence names the banner's Accept and Reject buttons as its square sample. Both are flagged for the human review rather than re-labeled here.

## Human review (2026-09-11)

Devin reviewed all 16 sites from pictures cut out of the 2026-09-10 captures: text samples per font family, button, card and text-field crops, and the largest images, one plain-language question per picture, with the agent tag shown as a caption. Raw answers: `benchmarks/semantic-human-review-2026-09-11.json`. The truth file now carries the derived labels, the reviewer, and per site an `unverifiedFields` list; its `humanReview` block states the derivation rules.

Two scores of the same v6 run. "Recorded" scores the file as written: a field the reviewer could not judge from a picture keeps the agent tag. "Verified" nulls every field in `unverifiedFields` and scores only what a picture confirmed.

| Gate | Recorded | Verified | Status (verified) |
|---|---|---|---|
| Font precision | 4/45 false positives | 3/45 | FAIL |
| Font recall ≥ 0.95 | 0.86 (42/49) | 0.97 (34/35) | PASS |
| Geometry accuracy, incidental flips = 0 | 0.42 (25/60): global 7/16, roles 18/44; flips 1 | 0.46 (18/39): global 7/16, roles 11/23; flips 1 | FAIL |
| Media top-two recall ≥ 0.90 | 0.69 (11/16) | 0.69 (11/16) | FAIL |
| Photography false positives < 0.05 | 1/16 (Monzo) | 1/16 | FAIL |

Against the agent tags the review moved 12 font tags, 4 button tags, 7 global verdicts, and 11 media top-two lists. Per-site changes are in each site's `humanChanges`.

Where the extractor misses on verified fields:

- **Fonts.** Three promoted families were marked not-brand from a real text sample: ABC Diatype Medium (Hyper Foundation, 27 text elements; the Regular weight is brand), Inter (Origin Financial, 10 text elements), Financier Medium (Auberge Resorts, 2 text elements). One accepted family was not promoted: Reader (Filling Pieces).
- **Geometry roles, 12 misses of 23.** Six are roles the extractor did not find at all: Hyper Foundation button, Mercury input, Linear card, Spline input, Wise card, Monzo input. Three are pill against rounded in both directions: Linear and Wise buttons are rounded in the truth and pill in the extractor; Spline buttons are pill in the truth and rounded in the extractor. Aevi buttons are pill against `mixed`. Filling Pieces buttons and inputs are square in the truth, judged from a newsletter popup's crops, and rounded and pill in the extractor, measured on the page; this is the one incidental flip.
- **Global, 7/16 on either score.** The file derives global from the judged roles and calls a disagreement `mixed`; the extractor weights roles by share. Monzo and Spline are `mixed` by the file's rule and pill and rounded by the extractor's; Apple is pill by the file and `mixed` by the extractor.
- **Media, 5 misses.** Woven's truth is now the age-gate logo (iconography) against `unknown`. Aevi and SwimClub are product-photography against photography. Spline is ui-screenshot against 3d-render (a WebGL scene framed by the editor's chrome). Monzo is ui-screenshot against photography (a photo of a phone showing the app), which is also the one photography false positive.

Caveats on the truth itself:

- 62 of 100 font answers were given on names with no text sample in the first three screens. The review page listed those under "no visible text uses them" with a bulk button. They stand as recorded and are listed unverified.
- The review page matched pictures to names by prefix, so five variant names were shown the parent family's text: N26-Fallback and N26-Extended-Fallback (N26's text), FavoritMedium (Favorit's), Lyondisplay Trial (Lyondisplay's), fira_sans-book_italic (fira_sans-book's), Wise Sans JP (Wise Sans's). All were marked brand. The file keeps the answers and lists them unverified; that difference is the whole gap between recorded recall (42/49) and verified recall (34/35).
- The Filling Pieces button and text-field crops came from a newsletter popup, not the page behind it.
- Wise's "Send money" button is a full pill in its own crop and the answer was softly rounded. The answer stands.
- Whether photography and product-photography, or 3d-render and ui-screenshot, should count as one family for top-two recall is a scorer question this review does not settle. Three of the five media misses sit on those two lines.

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
