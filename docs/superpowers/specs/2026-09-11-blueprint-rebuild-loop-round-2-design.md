# Blueprint rebuild loop, round two

**Date:** 2026-09-11
**Status:** Approved direction (user approved the round-two recommendation in chat; the first item was replaced after the probe below disproved it)
**Branch:** `worktree-blueprint-round-2`, stacked on `worktree-blueprint-loop` (PR #7)
**Reference site:** https://odysseycontracting.com/
**Round one:** `docs/superpowers/specs/2026-09-11-blueprint-rebuild-loop-design.md`, report `benchmarks/rebuild-round-1.md`

## Goal

Close the extraction misses that cost the round-one rebuild the most, rebuild the reference page again from the new extraction directory alone, and score it. Target: blueprint score from 29 to at least 60, no placeholder media source in any band on any benchmark site, and the round-one gates unchanged.

## Evidence this design rests on

Two probes on 2026-09-11 through the safe proxy, viewport 1280 by 800, after load plus network idle (`probe-gesture.mjs`, `probe-delayed.mjs` in the session scratchpad; counts only, nothing persisted):

1. **No delayed-script loader exists on the page.** The three non-JavaScript scripts are two `application/ld+json` blocks and one `speculationrules` block. A synthetic gesture (two mouse moves, a wheel tick, a key press, then network idle plus 1.5 s) changed nothing: Lottie 0 before and after, Swiper 0, `fusion-animated` 2, images resolved 1 of 18. The round-one report's "user-gesture loader" item is withdrawn. The DOM has 14 `fusion-fullwidth` bands; the 57 in the server HTML are not rendered and are not a target.
2. **The placeholder images are lazysizes attributes the collector never reads.** 16 of 18 `img` elements carry class `lazyload` with `currentSrc` set to a transparent `data:image/svg+xml` placeholder and the real source in `data-orig-src`, `data-srcset`, `data-sizes`. The scroll pass does not resolve them (the lazy script never swaps them in headless), and `waitForImages` counts them complete because the placeholder is complete. The band media collector reads `currentSrc` first, so `media.src` is the placeholder. This is round-one miss 2 in full.
3. **The reviews band holds one lazy iframe.** One `iframe` at document y 3527, 1200 by 150, same-origin, with `data-lazy-src` and no `src`. The band's `media.kind` is `none`. This is round-one miss 3: not a rendering failure, an embed the blueprint does not describe.
4. **The services band is one real section with a repeated card structure.** The band at y 4301 (h 3593, background `#2c3142`, confirmed dark in the original render) holds one row with a 1248 by 108 heading column and ten 624 by 616 columns (the last two 573), one image each. The band count is right; the miss is that the record says `cardCount 1`, `columns 2`, role `testimonial`. Round-one miss 4 ("15 bands where the page likely has 25 to 40") is withdrawn: the page has 14 to 15 sections.
5. **Background null on five bands is inheritance.** `body` and `html` paint `#ffffff`; bands 3, 6, 9, 11, 12 paint nothing themselves.
6. **The hero has no poster.** The `video` element has a source and `readyState 4` but no `poster` attribute. Nothing to extract; the record should say so.
7. **Overlapping bands cost the rebuild 900 px.** Bands 0, 1, 2 all start at y 0 (nav fixed, video wrapper, headline row inside it). The blueprint does not say a band sits on top of another, so the rebuild stacked them.

## What round two produces

1. Extractor changes below, each with a unit test on fixtures or recaptured records, and a 16-site benchmark rerun showing the seven round-one gate rows unchanged and one new gate passing.
2. A recapture of the reference page, a second rebuild under `benchmarks/rebuild/odyssey-round-2/`, and its fidelity and blueprint scores.
3. `benchmarks/rebuild-round-2.md`: scores against round one, the miss list re-ranked.

## Design

### 1. Lazy media resolution (miss 2)

In `collectPageData`, one shared helper `realImageSrc(img)` used by the band media collector and by `results.images`:

- A source counts as a placeholder when it is empty or starts with `data:`.
- Order: `currentSrc` unless placeholder; else `src` attribute unless placeholder; else the first URL of `data-srcset`, then `data-orig-src`, `data-src`, `data-lazy-src`, then `srcset` and a `picture > source[srcset]`; else the placeholder or empty string.
- The band media collector treats an `img` resolved from a lazy attribute as `photo` (or `svg` by extension) exactly as a loaded one; area comes from the box, which is already laid out.
- `results.images[].src` uses the same helper; `currentSrc` stays as observed. A new boolean `lazyUnresolved: true` marks an image whose displayed source is still a placeholder.
- `waitForImages` reports `placeholders`: the count of images whose displayed source is a `data:` placeholder while a lazy attribute exists. `evidence.capture.scroll.images` gains the field.

Background images: `bgOf` also reads `data-bg` and `data-background-image` when `background-image` is `none`.

Fixture `tests/fixtures/lazy-placeholders.html`: sections with `img.lazyload` carrying the transparent SVG placeholder as `src` and real `http://fixture.test/img/N.png` in `data-orig-src` plus `data-srcset`; one image with `srcset` only; one with `data-bg` on a div. Assert band `media.src` is the fixture URL, `media.kind` is `photo`, `images[].lazyUnresolved` is true, and `waitForImages().placeholders` equals the count.

### 2. Embeds as media (miss 3)

The band media collector includes `iframe` and `embed`/`object` as kind `embed` with `src` from `src`, `data-lazy-src`, or `data-src` (URL only, 500 chars). `media.kind` gains `embed`. `classifyRole` is unchanged; the rebuild sees "an embed of this size lives here".

Fixture: a band with a 1200 by 150 lazy iframe under a heading; assert `media.kind === 'embed'` and `share` about 0.16.

### 3. Repeated structure and role (misses 1 and 4)

New band field `repeats`: `{ count, w, h, perRow, withImage, withButton }` for the largest group of sibling elements, searched to depth 4 under the band, where the group has at least 3 members, each at least 100 px wide and 120 px tall, widths within 4 px of each other, heights within 15 percent of the group median. `perRow` is the number of members sharing the first member's rounded top. `withImage` and `withButton` count members containing an `img`, `video`, or `svg` at least 32 by 32, and members containing a `BUTTON_SELECTOR` match. `repeats` is `null` when no group qualifies.

`cardCount` becomes `max(selectorCount, repeats ? repeats.count : 0)`. `columns` uses `repeats.perRow` when `repeats` exists and `perRow >= 2`, else the existing row rule.

`classifyRole` (`src/extractors/section-roles.js`): before the testimonial rule, a band with `repeats.count >= 4` and `repeats.withButton >= repeats.count * 0.5` returns `{ role: 'feature-grid', subrole: 'cards', confidence: 0.85 }`. A testimonial carousel has quotes, not a button per card, so it keeps falling through to the testimonial rule. Records without `repeats` (older captures, landmark sections) are unchanged.

Fixture `tests/fixtures/blueprint-card-grid.html`: an Avada-shaped band with a heading column and ten 50 percent columns, each with an image and a button; assert `repeats.count 10`, `perRow 2`, `columns 2`, `cardCount >= 10`, and role `feature-grid` through `extractBlueprint`.

Blueprint output: `repeats` is carried onto the band (it holds no text). `<host>-blueprint.json` and the markdown band table show it as `cards 10 (2 per row)`.

### 4. Background inheritance and video poster (miss 5)

- When the chain and descendant search leave `background.color` and `imageUrl` both null, walk ancestors from the band's parent to `html`; the first painted background is recorded with `inherited: true`. Fixture: a white body with an unpainted section; assert `color '#ffffff'`, `inherited true`. A painted band records `inherited false`.
- `media.poster` is recorded for kind `video`: the `poster` attribute URL or `null`. The rebuild reads `null` as "no poster on the original".

### 5. Overlays (evidence 7)

`extractBlueprint` adds `overlay: true` to a band whose bounds lie inside an earlier band's bounds (x, y, w, h contained with 8 px tolerance) or whose `position` is `fixed` or `absolute`. Pure, tested on the round-one Odyssey records: bands 0 and 2 are overlays of band 1. `readingOrder` is unchanged. The rebuild brief tells the builder that overlay bands stack on the band before them and do not add height.

### 6. Blueprint fidelity

`scoreBlueprintFidelity` skips `overlay` bands when aligning by height, so a correct rebuild that stacks them is not penalised for band-count drift. `driftSuspected` keeps its meaning.

### 7. Leaks parked from round one

- `results.sections[].text` is stripped from `rawData.light` and `rawData.dark` in `src/index.js` after section roles are computed, with the same `stripBandText` helper (rename to `stripRecordText`). Test in `tests/blueprint.test.js`.
- The fidelity screenshot lane (`src/fidelity/run.js`, `fullPageShot`) launches through `startSafeBrowsingProxy` with the same launch arguments as `crawlPage`, `allowOrigin` applied to the clone side only. A test with the injectable screenshot asserts the original side's proxy is started without `allowOrigin`. SECURITY.md and the README drop the "not proxied" sentences.

### 8. Benchmark gate

`scoreBlueprintGates` adds `placeholderMediaSites`: sites with any band whose `media.src` starts with `data:`. Scorecard row "No placeholder media source on any site" must be 0 of 16. The seven existing rows must be unchanged from `blueprint-v12`.

### 9. Recapture, rebuild, score

- Recapture with round one's command into `benchmarks/results/rebuild-round-1/odyssey-extract-r2/` (git-ignored). Check: band count 14 to 16, every photo band has an `https` `media.src`, band 8 role `feature-grid` with `repeats.count 10`, band 7 media `embed`, bands 3, 6, 9, 11, 12 background `#ffffff` inherited, bands 0 and 2 `overlay`.
- Rebuild under `benchmarks/rebuild/odyssey-round-2/` from the new extraction directory only, same copy policy as round one (heading text verbatim, everything else placeholder), overlay bands stacked, lazy image URLs referenced as given.
- Score with `fidelity --clone-local --motion-runtime`; write `benchmarks/rebuild-round-2.md` with round one and round two side by side and the re-ranked miss list.

## Out of scope

- Copy: body text and CTA labels stay out of the extraction by policy.
- Triggering the lazy script or any gesture pass: disproved above.
- Reveal animations on this page: the DOM carries two; nothing to recover.
- Multi-page and responsive capture.

## Constraints carried from round one

No new dependencies. Crawler safety invariants unchanged; the fidelity screenshot lane joins the proxy rather than loosening anything. No page copy, HTML, bytes, cookies, or headers in output. Every reader-facing string from the page passes the existing projection. No em dashes in new prose.
