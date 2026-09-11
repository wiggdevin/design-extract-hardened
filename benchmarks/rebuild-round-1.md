# Odyssey Contracting rebuild, round one

This report measures the round-one static rebuild of https://odysseycontracting.com/
against the live page, and ranks what the extractor still misses. Every number
below comes from a file on disk. The source file for each number is named where
it is first used, and listed again in Sources at the end.

## 1. What ran

- Extractor commit: `9219516` ("fix: columns need disjoint members; relaxed retry
  keeps the landmark chain; reveal test covers both blocks"). This is the last
  commit that changes extractor code before the round-one rebuild
  (`ea58d14`) and this task's server fix (`b371981`, current HEAD).
- Extraction command:
  `node bin/design-extract.js https://odysseycontracting.com/ --full --screenshots --no-history --out benchmarks/results/rebuild-round-1/odyssey-extract`
- Wall time: **246.4s**, from the extraction log's "Completed in 246.4s" line
  (`odyssey-recapture-5.log`, the recapture run on commit `9219516`).
- Scroll steps and page height, from `evidence.capture.scroll`:
  `{"steps":12,"coveredPx":10282,"pageHeightPx":10282,"scroller":"window","capped":false,"images":{"total":18,"incomplete":1}}`
  (`round-1-notes.md`). This field is untouched by the three fixes in commit
  `9219516`; `round-1-notes.md` confirms the band table, order, and reveal count
  are byte-identical to the round-4 recapture run on that commit, so the scroll
  evidence carries over.
- Motion stack: `[{"name":"theme-reveal","evidence":["class"],"count":3}]`
  (`round-1-notes.md`). No `lottie` and no `swiper` entries.

### What the plan expected and what the page actually has

The blueprint spec that drove the extractor changes cited 57 full-width bands,
17 reveal animations, 3 Lottie players, and a Swiper carousel for this page.
That evidence came from the page's server HTML, fetched with curl. In a real
browser those elements never materialise. The site runs the Flying Press
plugin, which delays the scripts that inject them until a real user gesture.
The DOM the crawler sees has 2 `fusion-animated` elements with no configured
animation, zero `lottie-player` elements, zero `swiper` classes, and
`document.getAnimations()` returns nothing during the scroll pass. The
recaptured blueprint (15 bands, 0 reveals, motion stack `theme-reveal` only) is
the truth for what a headless crawl can observe today. Triggering the delayed
scripts is a round-two item (see section 6).

The spec's "20,564 px tall" figure was device pixels at scale 2. The page is
10,282 CSS px, and the extractor's 12 viewport steps cover it in full
(`capped: false`).

## 2. Extraction changes and the benchmark

Gate table, v7 (before this branch) vs v8 (after Tasks 1-8), from
`benchmarks/results/semantic-v7-2026-09-11/scorecard.md` and
`benchmarks/results/blueprint-v8-2026-09-11/scorecard.md`:

| Gate | v7 | v8 |
|---|---|---|
| Font precision (0 false positives) | 4/45 false positives, FAIL | 4/45 false positives, FAIL |
| Font recall >= 0.95 | 0.86 (42/49), FAIL | 0.86 (42/49), FAIL |
| Geometry accuracy, incidentalFlips = 0 | 0.63 (38/60), flips=0, PASS | 0.63 (38/60), flips=0, PASS |
| Media top-two recall >= 0.90 | 0.69 (11/16), FAIL | 0.69 (11/16), FAIL |
| Photography false-positive rate < 0.05 | 0.06 (1/16), FAIL | 0.06 (1/16), FAIL |
| Hero at top on >= 14/16 sites (new) | not yet a gate | 9/16, FAIL |
| No oversized band on any site (new) | not yet a gate | 4 sites, FAIL |
| Wall time (16-site benchmark) | 94.6s (94577ms, `run.json`) | 147.0s (147035ms, `run.json`) |

The five pre-existing gates are unchanged between v7 and v8. The scroll pass
added for reveal capture raised the 16-site wall time from 94.6s to 147.0s. The
two new gates both fail at v8: hero position and oversized bands are the
targets of the later fix rounds.

Landmark counts and wall time across the fix rounds, from
`landmarks.mjs semantic-v7-2026-09-11 blueprint-v8-2026-09-11 blueprint-v9-2026-09-11 blueprint-v11-2026-09-11 blueprint-v12-2026-09-11`:

| Run | Total bands | header | footer | section | Wall time |
|---|---|---|---|---|---|
| v7 (pre-branch) | 0 | 0 | 0 | 0 | 94.6s |
| v8 (after Tasks 1-8) | 222 | 6 | 3 | 52 | 147.0s |
| v9 (after Task 9b) | 300 | 7 | 3 | 72 | 136.9s |
| v11 (after 10b round 2) | 250 | 7 | 6 | 98 | 142.3s |
| v12 (final code, `9219516`) | 251 | 7 | 6 | 98 | 126.1s |

Scorecard gates for v9, v11, v12, all from their `scorecard.md`:

| Gate | v9 | v11 | v12 |
|---|---|---|---|
| Hero at top on >= 14/16 sites | 15/16, PASS | 14/16, PASS | 14/16, PASS |
| No oversized band on any site | 0 sites, PASS | 0 sites, PASS | 0 sites, PASS |

Both new gates pass from v9 onward and stay passing through the final code.
The five pre-existing gates (font precision, font recall, geometry, media
recall, photography false positives) are unchanged across every run in this
table; none of the fix rounds touched their inputs. Wall time drops from
147.0s (v8) to 126.1s (v12) as later fixes removed redundant walk work; v12
is still above v7's 94.6s baseline because the scroll and reveal-capture pass
that Task 1 added is now permanent.

## 3. Blueprint of the reference page

From `check-odyssey.mjs` against
`benchmarks/results/rebuild-round-1/odyssey-extract/odysseycontracting-com-blueprint.json`
(the extraction on commit `9219516`): 15 bands, `oversizedDropped` 0, hero
index 1, 0 reveals, 4 photo bands, 1 video band.

| idx | role | y | h | cols | media | background | heading | reveal |
|---|---|---|---|---|---|---|---|---|
| 0 | nav | 0 | 107 | 1 | svg | #000000 | - | - |
| 1 | hero | 0 | 800 | 1 | video | - | - | - |
| 2 | content | 0 | 800 | 1 | none | - | 65px | - |
| 3 | content | 800 | 144 | 3 | none | - | - | - |
| 4 | content | 944 | 615 | 2 | none | - | 28px | - |
| 5 | comparison | 1559 | 1475 | 2 | photo | #ede6dd | 29px "The Industry Reality vs. The Odyssey Sta[ndard]" | - |
| 6 | content | 3034 | 307 | 1 | photo | - | - | - |
| 7 | content | 3341 | 960 | 1 | none | #bbc7d4 | 42px | - |
| 8 | testimonial | 4301 | 3593 | 2 | photo | #2c3142 | 36px | - |
| 9 | cta | 7894 | 708 | 1 | photo | - | 42px | - |
| 10 | content | 8601 | 716 | 3 | none | #2c3142 | 42px | - |
| 11 | faq | 9317 | 271 | 1 | none | - | 24px | - |
| 12 | content | 9588 | 456 | 1 | none | - | 40px | - |
| 13 | content | 10044 | 408 | 4 | none | #2c3142 | 13px "ABOUT US" | - |
| 14 | content | 10451 | 331 | 1 | none | #121212 | 18px "Address" | - |

Reading order: `nav > hero > content > content > content > comparison >
content > content > testimonial > cta > content > faq > content > content >
content`, and this equals `intent.json`'s reading order (`check-odyssey.mjs`
output).

Band 5 is a real, two-column "Industry Reality vs. Odyssey Standard"
comparison. The earlier defect where the whole page was called a comparison
band is gone: one nav band, one hero at index 1, no oversized band anywhere
on the page.

## 4. Fidelity

From `benchmarks/results/rebuild-round-1/fidelity/fidelity.json` and
`fidelity.md` (command:
`node bin/design-extract.js fidelity https://odysseycontracting.com/ --clone http://127.0.0.1:4173 --clone-local --motion-runtime --out benchmarks/results/rebuild-round-1/fidelity`):

- **Overall: 61 (D)**
- **Visual: 47**
- **Motion: 81**
- **Blueprint: 29** (matched 22 of 75 possible points; see section 5)

Motion aspects (`fidelity.json`, `motionAspects`):

| aspect | score | original | clone |
|---|---|---|---|
| feel | 100% | mixed | mixed |
| durations | 33% | 100, 200, 300, 500 | 500 |
| easings | 65% | linear, ease-in-out, custom | custom |
| springs | 100% | 0 | 0 |
| keyframes | 100% | [] | [] |
| scrollLinked | 100% | true | true |
| choreography | 100% | 0 | 0 |

Correction directives, verbatim (`fidelity.json`, `directives`):

- `[low/motion]` motion aspect "durations" diverges from the original (score
  0.33). Fix: "Add transitions/animations near 100, 200, 300, 500ms, the
  clone is mistimed where the original moves."
- `[low/motion]` clone is missing easing families: linear, ease-in-out. Fix:
  "Apply the original's easing families (linear, ease-in-out, custom) via
  transition-timing-function instead of custom."

Both directives are low priority (`expectedGain` 1.33 and 0.71 out of 100).
The motion durations and easings the correction plan names (100/200/300/500ms;
linear, ease, `cubic-bezier(0.42,0.01,0.58,1)`) were captured by the
extraction, in `odysseycontracting-com-motion-tokens.json`
(`BUILD-NOTES.md`). The builder did not apply them to the clone's CSS
transitions. This is a build gap, not an extraction miss.

Visual fidelity (47) is a full-page pixel diff between the live page and the
clone, with no itemised breakdown in `fidelity.json` (`src/fidelity/run.js`
confirms `visual` and `overall` come only from the pixel diff and the motion
score; the blueprint score is reported separately and does not feed
`overall`). The diff image `fidelity-diff.png` is 1280 x 12065 px. The clone's
rendered page is 12065 px tall against the original's 10282 CSS px, about 17%
taller. This vertical offset misaligns nearly everything below the hero in
the pixel diff, so it is the largest single driver of the 47 visual score.
Section 5 explains why the page is taller.

## 5. Blueprint comparison

From `fidelity-blueprint.json`: **score 29**, matched 22 of 75, **14 aligned**
bands, **1 unmatched** band.

The comparer aligns band `i` of the original to band `i` of the clone
(`src/fidelity/blueprint-fidelity.js`). The "clone" bands here are not the
hand-authored `data-role` attributes in `index.html`. They come from the
extractor independently re-walking the running clone at
`http://127.0.0.1:4173`, the same way it walks any live site. That re-walk
detects **14 bands** on the clone against the original's 15
(`aligned = min(15, clone) = 14`, `unmatchedBands = |15 - clone| = 1` forces
`clone = 14`). One count short means every aligned pair from somewhere near
the top of the page is comparing two different original sections against
each other, not the two that actually correspond. `BUILD-NOTES.md` explains
the likely cause: the rebuild renders the nav, hero video, and hero headline
as three sequential, non-overlapping `<section>` bands, one per blueprint
band, because the original overlays all three at `y: 0` and the build
protocol requires one non-overlapping section per band. The clone's own
re-walk evidently does not detect three separate top bands the way the
hand-authored markup does; the resulting page is 12065 px tall against the
original's 10282 px, about 17% taller (`fidelity-diff.png` dimensions,
section 4), consistent with `BUILD-NOTES.md`'s own estimate of "roughly 900px
taller" for the hero region alone. This is a build-protocol consequence of
matching the original's overlap with sequential sections, not an extraction
fault: the original's own blueprint (three separate bands at `y: 0`, section 3
above) is confirmed correct.

Per-band results (`fidelity-blueprint.json`). Verdict key: **drift** = the
index misalignment above explains the failed checks (the aligned original and
clone bands are not really counterparts); **content** = role matched but the
clone differs in ways the drift does not explain; **flagged** = a defect
`BUILD-NOTES.md` or the task's own findings already named.

| idx | original role | clone-aligned role | failed checks | matched/5 | verdict |
|---|---|---|---|---|---|
| 0 | nav | hero | role, background, media, height | 1 | drift |
| 1 | hero | hero | background, media | 3 | content, the clone's hero `<video>` references a live, unfetched `.webm` URL (section 7 caveat) |
| 2 | content | content | background, columns, height | 2 | content |
| 3 | content | feature-grid | role, background, columns, height | 1 | drift |
| 4 | content | comparison | role, background, height | 2 | drift |
| 5 | comparison | content | role, columns, media, height | 1 | drift, the real comparison band (confirmed correct in section 3) is being scored against the wrong slot |
| 6 | content | testimonial | role, background, media, height | 1 | drift |
| 7 | content | content | background, columns, height | 2 | drift, plus the ratings band being near-empty (section 6) |
| 8 | testimonial | cta | role, background, columns, media, height | 0 | flagged, the single worst-scoring band; the role/content conflict below, compounded by drift |
| 9 | cta | content | role, background, columns, media | 1 | drift |
| 10 | content | faq | role, background, columns, height | 1 | drift |
| 11 | faq | content | role, background, height | 2 | drift |
| 12 | content | content | background, columns | 3 | content |
| 13 | content | content | background, columns, height | 2 | content |
| 14 (unmatched) | content ("Address") | - none - | all 5, by the scorer's formula | 0 | drift, the count-short clone has no 15th band to align to |

Band 8 (original y 4301, h 3593) is the extraction's clearest role/content
conflict. The blueprint classifies it `testimonial` (confidence 0.8), but its
geometry (`columns: 2`, `cardCount: 1`, `buttonCount: 24`, `media.share:
0.48`, `h: 3593`) and the full-page screenshot both show a two-column grid of
ten short service cards, each with its own button, sitting in one Avada row.
`BUILD-NOTES.md` kept `data-role="testimonial"` on the section per the build
rule to use the blueprint's role, but built the actual content as a
service-card grid to match the structural evidence. This is the extraction
not resolving a role/content conflict it created, by the brief's own rule
that "the extraction did not tell me" items are extraction misses.

## 6. What the extraction still misses, ranked by score cost

This is round two's input. Band-count drift (14 vs 15, section 5) and the
motion duration/easing gaps (section 4) are excluded here: drift is a build
consequence of the original's own bands being correctly overlapped, and the
motion gaps are build-side (the tokens were extracted; the clone doesn't use
them).

1. **Band 8, role/content conflict.** `role: testimonial` (confidence 0.8) on
   a band whose structure is a ten-card service grid. This is the single
   worst-scoring band in the blueprint comparison (0/5 checks passed,
   section 5). `BUILD-NOTES.md`.
2. **Band 8, card count wrong.** `cardCount: 1` recorded against ten real
   cards; `columns: 2` is right but the card collector doesn't count them
   because they carry no card-like class. `BUILD-NOTES.md`.
3. **Bands 5, 6, 8, 9, no real photography.** `media.src` for all four
   decodes to a transparent placeholder SVG (`fill-opacity="0"`), at
   724x668, 374x109, 1200x800, and 724x671. No real image was captured for
   any of these bands, most likely lazy-loaded or background-image assets
   the crawler didn't resolve. `BUILD-NOTES.md`.
4. **Band 7, ratings band is near-empty.** `textLength: 17`, no media,
   `h: 960`, sitting on a blank `#bbc7d4` region under a "reviews" heading.
   Consistent with an un-rendered third-party reviews widget the static
   capture never executes. `BUILD-NOTES.md`.
5. **Band segmentation stays coarse.** 15 bands detected against the
   benchmark's generic expectation of 25-40 for a page this size
   (`round-1-notes.md`, unchanged across every recapture). Band 8 alone
   folding ten cards into one band (item 2 above) is a concrete instance:
   the walk stops at the shared row wrapper instead of descending into
   per-card sections.
6. **No poster image for the hero video.** `background.hasVideo: true` with
   no poster field recorded, so the clone's `<video>` has nothing to show
   before the remote `.webm` loads. `BUILD-NOTES.md`.
7. **Band 5 media has no position within the band.** Only `share: 0.16` and
   the placeholder SVG's dimensions are recorded; nothing says whether the
   real photo sits beside a card, behind the heading, or elsewhere.
   `BUILD-NOTES.md`.
8. **Background color null on 5 bands** (indices 3, 6, 9, 11, 12). No color
   was extracted and no fallback exists in the brief, so these render on the
   page's default white surface. `BUILD-NOTES.md`.
9. **DESIGN.md breakpoints field is unusable.** Serializes as
   `[object Object]px` repeated 20 times, a real bug in the extractor's
   breakpoint formatting, not missing data. `BUILD-NOTES.md`. (Confirmed
   fixed for AGENT.md by `check-odyssey.mjs`'s `[object Object]` check,
   which is false; `BUILD-NOTES.md` reports the same bug specifically in
   `-DESIGN.md`, a separate file this task did not re-check.)
10. **Font Google-Fonts hosting status unstated.** `AGENT.md` and
    `DESIGN.md` name "Kumbh Sans," the four "Adero" weights, and "Satoshi
    Variable" without saying which are Google-hosted. `BUILD-NOTES.md`.
11. **Round two: trigger the delayed scripts.** The reference page's real
    reveal/Lottie/Swiper markup (section 1) sits behind a user-gesture-gated
    loader (Flying Press). A round-two crawl that fires a real interaction
    before reading the DOM may recover content the current pass cannot see.

## 7. Caveats

- The clone references the original's live image and video URLs directly;
  nothing was fetched or inlined.
- Lottie and canvas content are not read by the extractor.
- Hover and cursor effects are out of scope for this pass.
- This is a single-page rebuild; the extraction and comparison cover only
  the home page.
- The fidelity command's screenshot lane (`src/fidelity/run.js`) launches
  Chromium without the safe proxy for both the original and the clone page;
  `--clone-local` governs only the extraction lane, not the screenshot lane.
  This is pre-existing and unchanged by this branch. Listed for round two.

## Sources

- `benchmarks/results/semantic-v7-2026-09-11/scorecard.md`, `run.json`
- `benchmarks/results/blueprint-v8-2026-09-11/scorecard.md`, `run.json`
- `benchmarks/results/blueprint-v9-2026-09-11/scorecard.md`, `run.json`
- `benchmarks/results/blueprint-v11-2026-09-11/scorecard.md`, `run.json`
- `benchmarks/results/blueprint-v12-2026-09-11/scorecard.md`, `run.json`
- `landmarks.mjs` output over the five runs above
- `benchmarks/results/rebuild-round-1/odyssey-extract/odysseycontracting-com-blueprint.json`
- `check-odyssey.mjs` output
- `round-1-notes.md`
- `odyssey-recapture-5.log`
- `benchmarks/rebuild/odyssey-round-1/BUILD-NOTES.md`
- `benchmarks/results/rebuild-round-1/fidelity/fidelity.json`, `fidelity.md`,
  `fidelity-blueprint.json`, `fidelity-diff.png`
- `src/fidelity/blueprint-fidelity.js`, `src/fidelity/run.js`
- `/usr/bin/git log --oneline` (commit identification)
