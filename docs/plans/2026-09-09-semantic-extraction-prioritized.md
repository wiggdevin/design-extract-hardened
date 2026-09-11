# Semantic Extraction: Audit and Prioritized Plan

**Status:** supersedes `2026-09-09-semantic-extraction-strengthening.md` (kept unchanged as the audited artifact).
**Date:** 2026-09-09
**Baseline:** branch `hardened`, HEAD `f998cc1`, dirty tree (user-owned benchmark, Studio, CLI, rate-limit changes; `docs/plans/`, `docs/research/`, `benchmarks/`, `src/reference-benchmark.js` untracked).

---

## Part 1: Audit of the original plan

### What was verified

Every row of the original "current failure map" was checked against the checkout and is accurate:

| Claim | File | Verified |
|---|---|---|
| Font names take first comma item, strip quotes | `src/extractors/typography.js` `normaliseFamily` | Yes |
| `0px` radius dropped, values filtered `> 0` | `src/extractors/borders.js` `parseBorderRadius` | Yes |
| Radii averaged unweighted, any pill triggers `material-you` | `src/extractors/material-language.js` `borderProfile` | Yes |
| Media sampled only from `img, picture img, [role=img]` via `img.src` | `src/crawler.js` line 1131 | Yes |
| Imagery classified by filename, extension, size, counts | `src/extractors/imagery-style.js` | Yes |
| Confidence normalized by image count | `imagery-style.js` `winScore / (images.length * 0.3)` | Yes |

The ten-site benchmark outputs (`benchmarks/results/refero-premium-10-2026-09-09/`) confirm the user-visible damage:

| Failure | Sites hit (of 10) |
|---|---|
| Square system invisible (no `0` in `borders.radii`) | Woven `[50]`, SwimClub `[8, 26]` |
| `material-you` from one pill radius (Refero says editorial) | Apple, Emma Lewisham, Origin |
| `Times` promoted as a brand family | 7 sites |
| Malformed family `object-fit: contain` promoted | Woven |
| Photography false negative | Filling Pieces (249 images, `photoLike: 0`), Woven (`mixed`, 0) |
| Imagery confidence below 0.1 | 5 sites |

### Root causes the plan does not name

A live probe of Filling Pieces and Woven through the current crawler (saved outputs strip `_raw`) found four defects upstream of every semantic layer. None needs CDP, css-tree, or a model.

1. **`img.src` is empty for lazy and `srcset` images.** Filling Pieces: 243 of 249 sampled images have a blank `src`. The rendered URL is in `currentSrc`. This alone explains the "clearest imagery false negative" in the findings. The plan mentions `currentSrc` only inside the large Task 6 media rewrite.
2. **Non-rendered elements are counted as evidence.** `extractPageData` walks `querySelectorAll('*')` with no render filter. Woven's `Times` family (count 230) comes from `html`, `head`, `script`, `link`, `meta`. Woven's zero-radius tally includes 118 `link` and 81 `script` elements. Filling Pieces counts 425 `source` and 270 `path` elements. Every count-based signal (families, radii, spacing) is polluted.
3. **Percentage radii are read as pixels.** Woven's only radius `[50]` is `border-radius: 50%` on circular dots. `parseCSSValue` drops the unit.
4. **The `MAX_ELEMENTS = 5000` cap is hit** on Filling Pieces. Because non-rendered nodes consume budget, real content below the fold is never sampled.

Two more facts change the design:

5. **The malformed font is quoted:** the computed value is `"object-fit: contain"` on `<img>` elements. It is syntactically valid CSS. css-tree will accept it. The research spec says this itself ("a quoted nonsense font name is still valid CSS"). Provenance rejects it, not a parser. The crawler already collects the provenance needed: `fontData.documentFonts` with `status`, `fontData.fontFaces`, Google Fonts links, and `hasText` per element.
6. **Per-corner radii are already available.** Computed `border-radius` shorthand expands asymmetric corners (`0px 8px 0px 8px`). No `DOMSnapshot` is required to preserve zero.

### Structural findings on the plan

| # | Finding | Effect |
|---|---|---|
| A | Tasks 4 to 8 are sequenced behind Task 3 (CDP adapter, DOM fallback, network ledger, fixture). This is the largest and least certain task, and the benchmark failures do not need it. | Highest-impact fixes wait on the riskiest work. |
| B | Task 2 makes `css-tree` a prerequisite for every promoter. It does not fix the observed font failure (see 5) and needs a dependency approval. | Adds a gate and a lockfile change for no measured gain in slice 1. |
| C | Task 5 allows `{ value: 0 }` inside `borders.radii`. `tests/extractors.test.js` asserts `r.value > 0` for every entry. Consumers that index `radii[0]`, `slice(0, n)`, or `find(md) \|\| radii[0]` exist in `theme.js`, `tailwind-v4.js`, `token-sources.js`, `storybook.js`, `ts-defs.js`, `agent-prompt.js`, `dna/features.js`, `brand-essence.js`, `site-synthesis.js`, `fuse.js`, and the per-route path in `index.js`. The plan's audit search is scoped to `src/formatters` only. | Blast radius of about 20 files and a contract break the plan says it forbids. |
| D | Task 7 (occlusion sampling, 1,250 point queries) and Task 9 (Sharp and SigLIP bakeoff) address no failure in the ten-site corpus. | Effort without a benchmark case to win. |
| E | Task 3's network ledger exists to supply MIME for extensionless CDN images. Filling Pieces has one such image; the 243 blank ones are the problem. | Solves a secondary case first. |
| F | The plan's failure map and the ten-site findings both miss items 1 to 4 above. | The stated gates could pass on fixtures while live sites stay wrong. |
| G | Global constraints, security invariants, the additive output contract, the frozen benchmark, and the "raw evidence kept separate from promoted system" separation are all sound and are retained below. | Keep. |

### Verdict

The plan's diagnosis is correct and its architecture is defensible as an end state. Its ordering is inverted for impact. Four small collector and extractor fixes on data the crawler already gathers address every benchmark failure. The CDP adapter, css-tree, occlusion sampling, and the model bakeoff become gated follow-ups, each justified only by a gap the rerun benchmark still shows.

---

## Part 2: Prioritized plan

Ordering rule: sites fixed per line changed, highest first. Each slice is independently shippable and gated by the frozen benchmark. Every slice follows red-green: failing focused test, minimal change, focused rerun, then only the affected suite files. The full `npm test` runs once, at the end.

Retained constraints from the original plan: preserve the dirty tree, never persist raw page content, keep the hardened navigation path untouched, additive public fields only, no new dependency without approval, no commits without authorization.

### Slice 0: Freeze the baseline and the scorer

Original Task 1, trimmed to the three fields the gates need.

- Files: create `benchmarks/semantic-ground-truth-v1.json`, `tests/semantic-benchmark.test.js`; modify `src/reference-benchmark.js`.
- Ground truth per site: `fonts.accepted`, `fonts.rejected`, `geometry.global`, `geometry.byRole` (button, card, input, avatar), `mediaTopTwo`, `captureStatus`, `unscoredReason`. Adjudicate from the saved screenshots and the Refero record. Refero is an annotation, not truth.
- Scorer: `scoreSemanticExtraction(expected, actual)` returns raw counts and ratios per domain. Unscored sites leave the denominator.
- Also record: `git status --short`, HEAD, Node and Playwright versions, and one `npm test` result as the baseline.
- Verify: `node --test tests/semantic-benchmark.test.js tests/reference-benchmark.test.js`.
- Gate: scorer proves both a positive and a negative case per domain.

### Slice 1: Collector hygiene (new, highest impact)

Fixes root causes 1 to 4. Changes only `extractPageData` inside `src/crawler.js`; the navigation and security path is untouched.

- Skip non-rendered nodes before they consume element budget: anything inside `<head>`, and `script`, `style`, `link`, `meta`, `template`, `noscript`, `source`, `track`, and SVG internals below the `svg` root. Keep `svg` itself. Record `rendered: true` on kept nodes; keep `hasText`.
- Images: `src: img.currentSrc || img.src || first srcset candidate`, plus `naturalWidth`, `naturalHeight`, `loading`. Keep the no-refetch rule.
- Add CSS background media candidates from elements whose `backgroundImage` contains `url(`: `{ kind: 'css-background', src, width, height, top }`. This data is already captured per element; it only needs to be surfaced to `results.images` with a `kind` field. Default `kind: 'img'` for existing entries.
- Verify: extend `tests/network-safety.test.js` or add `tests/collector-hygiene.test.js` with a local fixture page (lazy `srcset` image, `<head>` styles, a CSS background). Then `node --test tests/network-safety.test.js tests/integration-security.test.js`.
- Gate on rerun: Filling Pieces blank `src` count drops from 243 to near zero; Woven `Times` count drops from 230 to near zero.

### Slice 2: Geometry with zero and role, no contract break

Original Task 5, reshaped to avoid finding C.

- Files: create `src/extractors/geometry-system.js`, `tests/geometry-system.test.js`; modify `src/extractors/borders.js`, `src/extractors/material-language.js`, `src/index.js`, `tests/extractors.test.js`.
- `borders.js`: keep `radii` positive-pixel-only (unchanged contract). Add `borders.observed`: unit-aware records `{ corners: [tl, tr, br, bl], unit: 'px' | '%', tag, role, classList, count }` including zero. Percentages never become pixels.
- `geometry-system.js`: infer owner from tag, ARIA role, and class tokens (`btn`, `button`, `card`, `input`, `avatar`, `badge`, `chip`, `pill`, `tag`, `nav`). Foundation roles: button, input, card, navigation, section. Output `borders.geometry = { global, byRole, observed }` where each decision is `{ value: 'square' | 'rounded' | 'pill', confidence, coverage, reasons, alternatives }`. Avatars, badges, and `50%` circles stay role-local unless three foundation roles agree.
- `material-language.js`: `pill` signal reads `borders.geometry.global` and the button role, not any `>= 500` value.
- Adversarial tests: square system with one avatar and one pill badge; pill-led button system; only-avatars page; percent radii; asymmetric corners.
- Verify: `node --test tests/geometry-system.test.js tests/extractors.test.js tests/v10-features.test.js`.
- Gate on rerun: Woven and SwimClub report `geometry.global.value === 'square'`; Apple, Emma, Origin no longer report `material-you`. Existing `radii` values unchanged on all ten sites.

### Slice 3: Font promotion by provenance

Original Task 4, without css-tree.

- Files: create `src/extractors/font-system.js`, `tests/font-system.test.js`; modify `src/extractors/typography.js`, `src/index.js`.
- Parse the full stack with a quote-aware splitter (the depth-aware `splitArgs` in `typography.js` is the pattern; add quote tracking). Reject declaration-shaped names (`contains ':'`), control characters, and values over 512 chars.
- Promote a family only with provenance beyond the computed string: loaded entry in `fontData.documentFonts`, an `@font-face` rule, a Google Fonts link, or use on `hasText` rendered elements above a small count. Generic and icon families remain fallback observations.
- Output `typography.system.bodyFamily`, `headingFamily`, `acceptedFamilies`, `rejectedFamilies` with reasons. `typography.families` keeps its shape but is built from the same filtered inventory.
- Verify: `node --test tests/font-system.test.js tests/extractors.test.js tests/formatters.test.js`.
- Gate on rerun: zero declaration-shaped families across ten sites; `Times` absent unless it renders visible text; at least 95% of adjudicated families retained (report the raw fraction).

### Slice 4: Media distribution by visible weight

Original Tasks 6 and 8, trimmed. Uses the `kind`, `currentSrc`, area, and `top` data from slice 1.

- Files: create `src/extractors/media-system.js`, `tests/media-system.test.js`; modify `src/extractors/imagery-style.js`, `src/index.js`.
- Weight: `width * height * viewportIntersectionFraction` from the captured rect and `top`. No occlusion sampling yet.
- Deterministic class per candidate: kind, extension or `data:` MIME, natural versus rendered size, aspect, SVG, `object-fit`, alt text, class hints. Filename hints capped at 10% of a score. Icon-sized candidates leave the denominator unless nothing else exists.
- Output adds `imageryStyle.distribution`, `dominantMedia`, `coverage`, `alternatives`; keeps `label`, `confidence`, `counts`, `signals`. Confidence derives from coverage and top-two margin, not image count.
- Verify: `node --test tests/media-system.test.js tests/extractors.test.js tests/v10-features.test.js`.
- Gate on rerun: at least 90% top-two recall and photography false positives below 5% on the adjudicated corpus, with raw counts; Filling Pieces and Woven report photography as top-two.

### Slice 5: Output contract and explanation

Original Task 10, trimmed.

- Files: create `tests/semantic-output-contract.test.js`; modify `src/index.js`, `src/formatters/markdown.js`, `src/formatters/design-md.js`, `src/formatters/agent-prompt.js`.
- `design.evidence = { schemaVersion: 1, collector: 'dom', coverage: {...}, warnings: [] }`. Each promoter has its own guarded call and a named warning. Formatters show "system" and "observed" separately.
- Verify: `node --test tests/semantic-output-contract.test.js tests/formatters.test.js tests/mcp.test.js tests/studio.test.js tests/prompt-security.test.js tests/export-security.test.js`.
- Gate: existing top-level fields and formatter entry points unchanged; no raw page content in public output.

### Slice 6: Rerun and report

Original Tasks 11 and 12.

- Rerun the ten-site benchmark at 1280x800 with three workers. Mark sites that changed or blocked.
- Run `npm test`, `npm audit --omit=dev`, `git diff --check` once.
- Report per gate: numerator, denominator, pass or fail. Manually inspect Woven (square, malformed font), Filling Pieces (lazy media), Apple (pill vs editorial), Hyperliquid (photo vs 3D).
- Append the measured decision to the research doc; do not rewrite its claims.

### Deferred, each gated by a measured gap after slice 6

| Item | Original task | Reopen only if |
|---|---|---|
| CDP `DOMSnapshot` adapter and DOM fallback | 3 | Font recall fails because computed strings and `document.fonts` cannot separate a rendered family from a declared one, or Shadow DOM or iframe media is still missed. |
| `css-tree` dependency | 2 | The quote-aware splitter fails an adversarial case that a real value lexer would pass. |
| Network ledger for MIME | 3 | Extensionless CDN images remain a top-two miss on any site. |
| Occlusion sampling | 7 | A visibly covered hero still dominates the distribution on a benchmark site. |
| Sharp and SigLIP bakeoff | 9 | Photography versus 3D or screenshot stays ambiguous after slice 4 on the adjudicated hard cases. |
| Refero agreement and dissent report | 11 | After slice 6, as reporting polish. |

### Preconditions to settle before slice 1

- The dirty tree carries the benchmark harness and the Studio, CLI, and rate-limit changes. Decide whether to commit the benchmark scaffolding first or run the slices in a worktree that carries only those files. The plan must not absorb the Studio or rate-limit changes.
- Ground-truth labels in slice 0 need a human pass over the saved screenshots. This is the only step that needs Devin's time.

### Expected effect per slice on the ten-site corpus

| Slice | Sites corrected | Size of change |
|---|---|---|
| 1 | Font noise on 7, media on 2, counts on all 10 | About 40 lines in one function |
| 2 | Geometry on 2, material label on 3 | New module plus two small edits |
| 3 | Malformed family on 1, `Times` on 7 | New module plus one edit |
| 4 | Imagery label on 4 or more | New module plus one edit |

---

## Execution record (2026-09-09, branch `worktree-semantic-evidence`)

Slices 0 to 5 were implemented and measured on 16 sites (the Refero ten plus six stress sites in `benchmarks/stress-sites-v1.json`). Ground truth: `benchmarks/semantic-ground-truth-v1.json`, agent-labeled, pending human review. Scorecard: `benchmarks/semantic-scorecard-2026-09-09.md`. Operating model: `docs/semantic-extraction.md`.

Gates: declaration-shaped families 0, font recall 43/43, square systems preserved with 0 incidental flips, photography false positives 0/16, semantic cost under 0.5% of crawl time. Font precision has 2 disputed promotions with provenance. Media top-two recall is 10/16.

Live-site defects found by the benchmark and fixed after the synthetic tests passed: button-label spans and zero-size or unpainted boxes voting on geometry; page containers swamping the global vote; sub-3px corners read as rounded; families promoted on visible text with no loaded font; large PNG heroes called screenshots; extensionless heroes called photographs; a `url(#id)` filter reference treated as a background image; posters treated as photographs regardless of source.

Deferred items, measured: the media misses (Aevi and SwimClub PNG heroes, N26 and Linear extensionless CDNs, Spline's canvas) are exactly the pixel-bound cases; Task 9 (Sharp, then SigLIP as an ambiguity lane) is now justified by 5 of 16 sites. The CDP adapter, css-tree, the network ledger, and occlusion sampling were not needed for any measured failure and stay deferred. Woven's age gate is an interaction gap for the crawler, not a classification gap.
