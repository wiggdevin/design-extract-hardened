# Odyssey Contracting rebuild, round two

This report measures the round-two static rebuild of https://odysseycontracting.com/
against the live page, compares it with round one, and re-ranks what the
extractor still misses. Every number below comes from a file on disk. The
source file for each number is named where it is first used, and listed again
in Sources at the end. Round one is `benchmarks/rebuild-round-1.md`.

## 1. What ran

- Extractor commit for the recapture: `ba0e7d2` ("feat: benchmark gate for
  placeholder media sources in blueprint bands"). This is the last commit that
  changes collector or blueprint code on the round-two branch. The two later
  code commits touch only the benchmark gate predicate (`c5a086e`) and the
  fidelity row index (`d2d51de`); neither changes what the crawler records.
- Extraction command:
  `node bin/design-extract.js https://odysseycontracting.com/ --full --screenshots --no-history --out benchmarks/results/rebuild-round-2/odyssey-extract`
- Wall time: **261.9s**, from the extraction log's "Completed in 261.9s" line
  (`odyssey-r2.log`). Round one was 246.4s on the same page. The difference is
  the repeated-structure walk added in Task 3 plus normal network variance.
- Rebuild: `benchmarks/rebuild/odyssey-round-2/` (commits `845e067`, then
  `483d4d6` for the builder's Revision 3). Served with a static server on
  port 4174.
- Fidelity command:
  `node bin/design-extract.js fidelity https://odysseycontracting.com/ --clone http://127.0.0.1:4174 --clone-local --motion-runtime --out benchmarks/results/rebuild-round-2/fidelity`
  run first on `483d4d6`, then again on `2a42ee9` after the fix wave (the
  final numbers in this report).
- Fix wave after the final branch review (`fc96887` to `c6ef1a1`, then
  `2a42ee9`): the overlay rule exempts the hero and flags fixed or absolute
  bands plus containment against all earlier bands; `columns` takes the
  larger of the row rule and `repeats.perRow`; the placeholder gate also
  catches base64 SVG and tiny raster placeholders; the proxied screenshot
  lane has a test that fails without the proxy; paired launches use
  `allSettled`; page-derived image URLs must be `http(s)`. The reference
  page was recaptured on the fixed code into
  `benchmarks/results/rebuild-round-2/odyssey-extract-fix2/`, and the band
  table in section 3 is from that capture. The rebuild itself was built from
  the first capture and was not rebuilt.
- Benchmark: `benchmarks/results/blueprint-r2-2026-09-11/` (16 sites, run on
  `ba0e7d2`, re-scored after `c5a086e`).

### Round-one items that were withdrawn

Round one listed two items that round two's probes disproved before any code
was written. Both are recorded here so nobody re-opens them.

- **"Trigger the delayed scripts" (round one, item 11).** Two probes through
  the safe browsing proxy (`probe-delayed.mjs`, `probe-gesture.mjs`) found no
  delayed-script loader on the page. The only non-JavaScript scripts are two
  `ld+json` blocks and one `speculationrules` block. A synthetic click, key
  press and wheel event before reading the DOM changed nothing: no
  `lottie-player`, no `swiper` class, zero `document.getAnimations()`. The
  Swiper and Lottie markup cited in the round-one spec came from the server
  HTML and never materialises in a browser. There is nothing to trigger.
- **"Band segmentation stays coarse: 15 bands against 25 to 40" (round one,
  item 5).** The probes counted the page's real full-width sections: 15. The
  services band at y 4301 is one dark `#2c3142` row holding a heading column
  and ten equal 624x616 columns; it is one band with ten repeated children,
  not ten bands. The 25 to 40 figure was a generic expectation for a page of
  this height, not a measurement. The right fix was to record the repeated
  structure inside a band (Task 3), which round two did.

## 2. Extraction changes and the benchmark

Gate table, v12 (round-one final code, `9219516`) vs r2 (this branch,
`ba0e7d2` re-scored after `c5a086e`), from
`benchmarks/results/blueprint-v12-2026-09-11/scorecard.md` and
`benchmarks/results/blueprint-r2-2026-09-11/scorecard.md`:

| Gate | v12 | r2 |
|---|---|---|
| Font precision (0 false positives) | 4/45 false positives, FAIL | 4/45 false positives, FAIL |
| Font recall >= 0.95 | 0.86 (42/49), FAIL | 0.86 (42/49), FAIL |
| Geometry accuracy, incidentalFlips = 0 | 0.63 (38/60), flips=0, PASS | 0.63 (38/60), flips=0, PASS |
| Media top-two recall >= 0.90 | 0.69 (11/16), FAIL | 0.69 (11/16), FAIL |
| Photography false-positive rate < 0.05 | 0.06 (1/16), FAIL | 0.06 (1/16), FAIL |
| Hero at top on >= 14/16 sites | 14/16, PASS | 15/16, PASS |
| No oversized band on any site | 0 sites, PASS | 0 sites, PASS |
| No placeholder media source on any site (new) | not yet a gate | 0 sites, PASS |
| Wall time (16-site benchmark, `run.json` wallMs) | 126.1s (126087ms) | 138.6s (138556ms) |

The five pre-existing gates are byte-identical between v12 and r2. The hero
gate gained one site: Woven Whisky (`568a26f6`) opens with a Vimeo iframe,
which round two now records as media kind `embed` with share 1, so its top
band qualifies as the hero. The new placeholder gate passes on all 16 sites.
Its first version (`ba0e7d2`) flagged two sites, N26 and Mercury, whose bands
carry real inline base64 images; the predicate was narrowed in `c5a086e` to
"a non-base64 SVG data URI with no drawing element", which is exactly what
lazysizes emits, and the run was re-scored without re-crawling.

Per-site wall time from the two `run.json` files (`results[].ms`, n=16):

| Run | Total wall | Median site | Fastest | Slowest | Sum of sites |
|---|---|---|---|---|---|
| v12 | 126.1s | 16.4s | 6.6s | 49.8s | 360.8s |
| r2 | 138.6s | 18.0s | 7.2s | 51.1s | 396.9s |

The repeated-structure walk (Task 3) is the only new per-band work, and it
costs about 10% of wall time across the benchmark. Task 3's review flagged
the walk's per-member `querySelectorAll` as uncapped; it runs in the same
order as the existing per-band button, card and media queries, and this is
the measured cost. Acceptable for now; noted in section 7.

## 3. Blueprint of the reference page

From `check-odyssey-r2.mjs` against
`benchmarks/results/rebuild-round-2/odyssey-extract-fix2/odysseycontracting-com-blueprint.json`
(the recapture on `2a42ee9`, wall time 236.5s): 15 bands, `oversizedDropped`
0, hero index 1, 0 reveals. Roles: nav 1, hero 1, content 8, comparison 1,
feature-grid 2, cta 1, faq 1. All eight spec checks pass, including
"overlays on bands 0 and 2". The first capture (`odyssey-extract/`, on
`ba0e7d2`, the one the rebuild was built from) differs in two cells only:
it flagged bands 0 and 1 as overlays and recorded band 13 with 3 columns.

| idx | role | y | h | cols | cards | repeats (count x w x h, per row, with image, with button) | media | background | inherited | overlay |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | nav | 0 | 107 | 1 | 19 | - | svg 0.09 | #000000 | no | yes |
| 1 | hero | 0 | 800 | 1 | 0 | - | video 1, poster null | #ffffff | yes | no |
| 2 | content | 0 | 800 | 1 | 0 | - | none | #ffffff | yes | yes |
| 3 | content | 800 | 144 | 3 | 1 | - | none | #ffffff | yes | no |
| 4 | content | 944 | 615 | 2 | 1 | - | none | #ffffff | yes | no |
| 5 | comparison | 1559 | 1475 | 2 | 40 | - | photo 0.16 `Rectangle-4-3.png` | #ede6dd | no | no |
| 6 | content | 3034 | 307 | 1 | 1 | - | photo 0.22 `certainteed-msa1-1.png` | #ffffff | yes | no |
| 7 | content | 3341 | 960 | 1 | 1 | - | embed 0.67 `links.odysseycontracting.com/.../review_widget/...` | #bbc7d4 | no | no |
| 8 | feature-grid | 4301 | 3593 | 2 | 10 | 10 x 624 x 616, 2 per row, 10 with image, 8 with button | photo 0.48 `Addition-and-deck.jpg` | #2c3142 | no | no |
| 9 | cta | 7894 | 708 | 1 | 5 | - | photo 1 `Frame-1.png` | image `Frame-1.png` | no | no |
| 10 | feature-grid | 8601 | 716 | 3 | 3 | 3 x 416 x 426, 3 per row, 0 with image, 3 with button | photo 0.51 `1-7.jpg` | #2c3142 | no | no |
| 11 | faq | 9317 | 271 | 1 | 9 | - | none | #ffffff | yes | no |
| 12 | content | 9588 | 456 | 1 | 1 | - | photo 1 `Rectangle-5-4.png` | image `Rectangle-5-4.png` | no | no |
| 13 | content | 10044 | 408 | 4 | 27 | 3 x 312 x 238, 3 per row, 0 with image, 3 with button | none | #2c3142 | no | no |
| 14 | content | 10451 | 331 | 1 | 4 | - | none | #121212 | no | no |

Reading order: `nav > hero > content > content > content > comparison >
content > content > feature-grid > cta > feature-grid > faq > content >
content > content`.

Against round one's table, the same page now reads differently in five ways:

- Bands 5, 6, 8, 9 carry real image URLs on `odysseycontracting.com`. Round
  one recorded a transparent placeholder SVG for all four. Sixteen of the
  page's eighteen images are lazysizes placeholders; the real URL sits in
  `data-orig-src` and `data-srcset`, which Task 1 now reads.
- Band 7 is `embed` 0.67: the reviews widget is a lazy same-origin iframe
  (1200x150, `data-lazy-src`). Round one recorded it as an empty band.
- Band 8 is `feature-grid` with `repeats` 10 x 624 x 616, 8 of 10 with a
  button. Round one called it `testimonial` with `cardCount` 1.
- Band 10 and band 13 also carry `repeats` (3 cards each). Band 13's
  `columns` stays 4: the first capture let `repeats.perRow` overwrite it
  with 3, the builder flagged that the live footer shows four columns, and
  the fix wave made `columns` the larger of the two (section 6, item 4).
- Bands 0 and 2 are overlays: the absolute header over the hero, and the
  headline row contained in the hero's box. The hero itself stays in flow.
- Bands 3, 4, 6, 11 and the two hero bands inherit `#ffffff` from `body`
  instead of recording `null`. Bands 9 and 12 record their background image.
  No band has a null background any more.

`media.poster` is `null` on the hero: the page's `<video>` really has no
poster attribute (`probe-delayed.mjs`), so this is a fact about the page, not
a miss.

## 4. Fidelity

Three measurements, all from the named `fidelity.json` files and the same
command shape (clone port differs):

| Measure | Round one (`rebuild-round-1/fidelity`) | Round two, first build (`845e067`, before Revision 3) | Round two, Revision 3 on `483d4d6` | Round two, final (`2a42ee9`) |
|---|---|---|---|---|
| Overall | 61 (D) | 55 (F) | 61 (D) | **61 (D)** |
| Visual | 47 | 38 | 48 | **48** |
| Motion | 81 | 81 | 81 | **81** |
| Blueprint | 29 (22/75) | 25 (16/65) | 86 (56/65) | **89 (58/65)** |
| Bands aligned | 14 | 11 | 13 | 13 |
| Unmatched bands | 1 | 2 | 0 | 0 |
| Drift suspected | not reported | true | false | false |
| Clone page height | 12065 px | 9350 px | 10527 px | 10527 px |
| Original page height (screenshot lane) | 10282 px | 10822 px | 10822 px | 10822 px |

The first-build and Revision 3 numbers are from runs recorded in the ledger;
their `fidelity.json` was overwritten by the final run and the numbers
survive only in the ledger and this table. The extractor's own re-walk of
the first build (`clone-blueprint-r2.mjs`) found the causes of the drop: the
hero copy was absolutely positioned (a third overlay the blueprint does not
flag), the three-button row rendered 113 px and fell under the 120 px band
floor, and nine bands were more than 15% off the recorded height. All three
were build defects; the fix was `min-height` on the affected sections and
moving the video behind the in-flow hero section (`BUILD-NOTES.md`,
Revision 3).

The move from 86 to 89 is an extractor fix, not a build change. The final
whole-branch review found that the overlay rule flagged the hero video band
itself (it is absolutely positioned) and let the in-flow headline row
escape, so the scorer had dropped the hero from the comparison. With the
corrected rule (`fc96887`, `2a42ee9`) the overlays are bands 0 and 2, as the
spec's acceptance check says, and the hero band is scored.

The blueprint denominators differ between rounds. Round one scored 15 bands
(75 points) with no overlay handling; round two scores the 13 in-flow bands
(65 points) after both sides' overlay bands are removed from alignment. The
29 to 89 comparison is therefore not like-for-like on the denominator; the
per-band rows in section 5 are the fair comparison.

The overall score is the weighted pixel diff and motion score only
(`src/fidelity/run.js`); the blueprint score is reported beside it and does
not feed `overall`. That is why overall stays at 61 while blueprint moves
from 29 to 89.

Motion aspects (`fidelity.json`, `motionAspects`) are identical to round one:
feel 100%, durations 33% (original 100/200/300/500 ms, clone 500 ms), easings
65% (clone lacks linear and ease-in-out), springs, keyframes, scrollLinked and
choreography 100%. The two low-priority directives are the same as round
one's. The tokens are in `odysseycontracting-com-motion-tokens.json`; the
builder applied only the 500 ms duration and the custom curve
(`BUILD-NOTES.md`, Tokens). Build gap, not extraction miss, as in round one.

### The visual score is capped by a measurement artefact

Visual fidelity is a full-page pixel diff (`fidelity-diff.png`, 1280 x
10527). The original's screenshot is taken by the fidelity command's
screenshot lane without scrolling, and lazysizes never swaps its
placeholders in that capture, so the original renders with blank image
slots on bands 5, 6, 8, 9 and 12. The clone renders the real photographs at
the URLs the round-two extraction resolved. A clone that is more faithful to
the live page therefore scores lower on visual than one that left the slots
blank. Round one's clone had blank slots too, which is part of why its
visual score (47) is so close to round two's (48) despite the blueprint
alignment improving. The fix is in the screenshot lane, not the clone; it is
item 3 in section 6.

## 5. Blueprint comparison

From `fidelity-blueprint.json` (final run on `2a42ee9`): **score 89**,
matched 58 of 65, **13 aligned** bands, **0 unmatched**, `driftSuspected`
false. Both sides' overlay bands (original 0 and 2; clone 0 and its
absolutely positioned video layer) are filtered before alignment, so 13
in-flow bands align to 13 in-flow bands and every row compares true
counterparts. `index` is the original band's own index.

| idx | original role | clone role | failed checks | matched/5 | verdict |
|---|---|---|---|---|---|
| 1 | hero | hero | columns | 4 | build: the clone's hero section holds the copy column beside the video layer |
| 3 | content | content | columns (3 vs 1) | 4 | build: the three buttons sit in one flex wrapper, which the columns rule reads as one column |
| 4 | content | content | columns (2 vs 1) | 4 | build |
| 5 | comparison | comparison | - | 5 | match |
| 6 | content | content | - | 5 | match |
| 7 | content | content | media (embed vs none) | 4 | build rule: the brief forbids live embeds, so the reviews widget is a labelled block |
| 8 | feature-grid | feature-grid | - | 5 | match (round one: 0/5) |
| 9 | cta | cta | columns (1 vs 2) | 4 | build |
| 10 | feature-grid | feature-grid | - | 5 | match |
| 11 | faq | faq | - | 5 | match |
| 12 | content | content | columns (1 vs 2) | 4 | build |
| 13 | content | content | columns (4 vs 3) | 4 | build from a stale record: the clone followed the first capture's `repeats` (3 columns); the corrected extractor records 4 |
| 14 | content | content | - | 5 | match |

All seven lost points are columns or the embed rule, on the clone's side of
the comparison. None of the thirteen rows fails role, background or height,
and the hero row is now scored. Band 8, round one's worst row at 0 of 5, is
a full match: the role/content conflict and the card count were both
extraction misses in round one and both are closed.

## 6. What the extraction still misses, ranked by score cost

The blueprint comparison no longer points at the extractor, so this list is
ranked by what would move the visual score and the builder's stated gaps
(`BUILD-NOTES.md`, "Bands not fully reproducible" and "Copy").

1. **Heading text is empty on eight bands.** `heading.text` is `""` on bands
   2, 4, 7, 8, 9, 10, 11 and 12 while `heading.fontSize` and `level` are
   recorded. The builder recovered six headings by reading the screenshots
   and wrote placeholder copy for the other two. Every one of those bands
   renders different words from the original, which the pixel diff charges
   in full.
2. **One image URL per band.** Band 8 records `repeats.withImage` 10 but a
   single `media.src`; band 10 records one URL for three cards. The clone
   reuses the one image across all cards. Recording the media URL per repeat
   member would close this.
3. **The original's screenshot lane does not resolve lazy images.** Section 4
   explains the effect. The fidelity screenshot should scroll the page, or
   swap each lazysizes placeholder for its resolved URL, before capture. This
   is the largest single lever on the visual score and it is on the
   extractor's side.
4. **Footer repeats count 3 against four visible columns.** Band 13's
   `repeats` is 3 x 312 x 238; the responsive screenshot shows four footer
   columns. The fourth column has a different size and falls outside the
   width and height tolerance of the repeat group, so the group under-counts
   it. The first round-two capture also let `repeats.perRow` overwrite the
   row rule's 4; the fix wave (`c3a08fc`) makes `columns` the larger of the
   two, and the recapture records 4 again. The repeat group's own
   under-count remains.
5. **`cardCount` is noise when `repeats` is null.** Band 5 records
   `cardCount` 40 with no `repeats`; band 11 records 9; band 13 records 27
   beside `repeats.count` 3. The selector-based count survives as
   `max(selector, repeats.count)` and the builder rightly ignored it.
6. **Nav background has no alpha.** Band 0 records `#000000` while the nav
   is a translucent bar over the hero; the builder rendered a gradient by
   judgment.
7. **Nav `buttonCount` 9 against five visible controls.** The extra four are
   not identifiable from the blueprint.
8. **Heading font family disagrees across outputs.** `DESIGN.md` and
   `AGENT.md` name "Adero Semi-Bold" for headings; `reset.css` sets headings
   to "Kumbh Sans". The builder followed `reset.css`.
9. **Motion durations and easings** are extracted but the clone does not use
   them (section 4). Build gap, carried unchanged from round one.

Closed since round one: band 8 role (item 1), band 8 card count (item 2),
placeholder photography on four bands (item 3), the near-empty ratings band
(item 4, now an embed band), band segmentation (item 5, withdrawn), the hero
poster (item 6, the page has none and the blueprint now says so), null
backgrounds on five bands (item 8), and the delayed-script loader (item 11,
withdrawn). Round one's item 7 (media position within a band), item 9
(`DESIGN.md` breakpoints) and item 10 (font hosting) were not re-checked in
this round.

## 7. Caveats

- The clone references the original's live image and video URLs directly;
  nothing was fetched or inlined. Nine of ten service-card images and two of
  three project images are the same file (item 2 above).
- The first-build fidelity numbers in section 4 are quoted from the ledger,
  not from a surviving file.
- The wall-time cost of the repeated-structure walk (about 10% on the
  benchmark) has not been profiled on a page with a very large repeated
  widget.
- Both the original and clone screenshots now go through the safe browsing
  proxy with the crawl's egress arguments (`35dcf51`), which closes round
  one's last caveat. `--clone-local` reaches the clone shot only.
- The round-two clone was revised once against the scorer: Revision 3 in
  `BUILD-NOTES.md` adds `min-height` to eight bands and trims one so that
  each lands inside the 15% height tolerance. Round one's clone was built
  once and never revised. The blueprint score is therefore partly fitted to
  the metric it reports, and the two rounds are not a like-for-like build
  comparison on that axis.
- Lottie and canvas content are not read by the extractor. Hover and cursor
  effects are out of scope. This is a single-page rebuild of the home page.

## Sources

- `benchmarks/results/blueprint-v12-2026-09-11/scorecard.md`, `run.json`
- `benchmarks/results/blueprint-r2-2026-09-11/scorecard.md`, `run.json`
- `benchmarks/results/rebuild-round-2/odyssey-extract/odysseycontracting-com-blueprint.json`
- `check-odyssey-r2.mjs`, `clone-blueprint-r2.mjs`, `shot-clone-r2.mjs`,
  `probe-delayed.mjs`, `probe-gesture.mjs` output (session scratch)
- `odyssey-r2.log`
- `benchmarks/rebuild/odyssey-round-2/BUILD-NOTES.md`
- `benchmarks/results/rebuild-round-1/fidelity/fidelity.json`
- `benchmarks/results/rebuild-round-2/fidelity/fidelity.json`, `fidelity.md`,
  `fidelity-blueprint.json`, `fidelity-diff.png`
- `.superpowers/sdd/2026-09-11-blueprint-rebuild-loop-round-2/progress.md`
  (first-build fidelity numbers)
- `src/fidelity/blueprint-fidelity.js`, `src/fidelity/run.js`
- `/usr/bin/git log --oneline b729901..HEAD` (commit identification)
