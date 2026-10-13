# Build notes — Odyssey Contracting rebuild (round 1)

## Files read (all under `benchmarks/results/rebuild-round-1/odyssey-extract/`)

- `odysseycontracting-com-blueprint.json` — 15 bands, reading order, heading text, bounds, media, counts.
- `odysseycontracting-com-design-tokens.json` — DTCG primitive/semantic colour, spacing, radius, shadow, font, type-scale tokens.
- `odysseycontracting-com-variables.css` — bare CSS custom properties (used to cross-check the token JSON; the WP/Avada preset variables in the back half of the file were not used, see below).
- `odysseycontracting-com-DESIGN.md` — colour/type/layout/shape/voice/component summary.
- `odysseycontracting-com-AGENT.md` — build rules (don't invent hex/family/off-scale spacing, match voice).
- `odysseycontracting-com-motion-tokens.json` — durations (100/200/300/500ms) and easings (linear, ease, `cubic-bezier(0.42,0.01,0.58,1)`).
- `screenshots.json` (referenced from a component-screenshot manifest, path `screenshots/`) — full-page screenshot and 11 cropped component screenshots (buttons, cards).
- `screenshots/full-page.png`, `screenshots/button-default-large-0.png`, `screenshots/card-default-0.png`, `screenshots/card-default-2.png` — viewed for layout/colour/proportion calibration only, **not** for copy (see Copy policy below).

No other file in the repository was opened. No network request was made; the two known media URLs (nav logo SVG, hero `.webm`) are referenced by `src` as given, not fetched or inlined.

## Copy policy actually applied

Per the brief, only `heading.text` values present in the blueprint were used verbatim:
- Band 5: "The Industry Reality vs. The Odyssey Standard"
- Band 13: "ABOUT US"
- Band 14: "Address"

Every other band's `heading.text` was `null` or `""` in the blueprint — including the hero (band 2), the services band (band 8), the CTA bands (9, 12), ratings (7) and featured-projects (10) headings. For those, and for all body copy, list items, service names, FAQ questions, and footer link labels, I wrote fresh placeholder copy rather than transcribing the real copy visible in `full-page.png` and the two card screenshots (e.g. the real "Vague Estimates & Surprises" / "Detailed Line-Item Proposals" comparison items, and the real 10 service names like "Custom Decks", "Roof Repair and Replacement"). The screenshots were used only to confirm layout, color blocking, card count/shape, and button styling — never copied as text. This is a deliberate, conservative reading of "for everything else write placeholder sentences ... that read as plausible contracting-company copy" — flagging it here because it is a judgment call: a looser reading could argue generic industry category labels ("Kitchen Remodeling") aren't really "copy" worth protecting. I erred toward inventing my own wording everywhere except the three literal `heading.text` fields.

No phone numbers, street addresses, or prices were invented anywhere (footer "Address" band uses "Serving Raleigh, North Carolina and the surrounding area" — no street/zip).

## Bands I could not reproduce faithfully, and why

- **Bands 0–2 (nav / hero video / hero headline) overlap in the source.** The blueprint gives band 0 (nav) and band 2 (headline+CTA) both `position: absolute`/`relative` at `y: 0`, stacked visually on top of band 1's `y: 0, h: 800` video. The blueprint gives no z-index or exact overlay geometry beyond `bounds`, and reproducing true absolute overlays inside a vanilla, no-build static page risked breaking "must not scroll horizontally" and made per-band height matching ambiguous. I rendered all three as sequential, non-overlapping `<section>` bands instead (nav 107px, hero video 800px, hero-copy 800px stacked below it). This satisfies "one `<section>` per band, in order" and each band's individual height, but does **not** reproduce the real page's ~800px-tall combined hero (the rebuild's top is roughly 900px taller than the source's actual hero region). This is the single biggest structural deviation from the true layout.

- **Bands 5, 6, 8, 9 media (`media.src`) are transparent placeholder SVGs**, not real captured photography — the blueprint's `data:image/svg+xml,...` values for these bands all decode to a rect with `fill-opacity="0"` (fully transparent), at recorded dimensions of `724×668` (band 5), `374×109` (band 6), `1200×800` (band 8), and `724×671` (band 9). The extraction did not capture real imagery for any of these bands (likely lazy-loaded/background-image assets the crawler didn't resolve). I did not literally embed the transparent data URIs (an invisible image would misrepresent "media kind: photo" to a reviewer); instead every one of these four bands gets a `.media-placeholder` block in `index.html`, sized to its band's recorded aspect ratio: one accent placeholder above the comparison cards in band 5, one small icon-sized placeholder per badge in band 6's row, one placeholder inside each service card in band 8, and one placeholder image below the copy in band 9. For band 5 specifically, the blueprint only records `share: 0.16` and the SVG's dimensions — it gives no x/y position within the band, so I could not tell whether the real photo sat beside one card, behind the heading, or elsewhere; I placed a single centered placeholder above the two cards as a reasonable guess, not an extracted fact. This is a direct instance of "the extraction did not tell me what I needed" — there is no real photo to reference or reason about (composition, subject, crop) for any of these four bands. (An earlier revision of `index.html` omitted band 5's placeholder entirely — that was a bug, now fixed; see Fix log.)

- **Band 7 (Ratings) is mostly empty in the blueprint** (`textLength: 17`, no media, `h: 960`) despite a large height. Cross-referencing the full-page screenshot, this band sits exactly where a tall, visually blank steel-blue (`#bbc7d4`) region appears under a "reviews" heading — consistent with an un-rendered third-party reviews widget (e.g., Shopper Approved / Google reviews carousel) that the crawler's static capture didn't execute. I built a labeled placeholder block rather than guessing at real review content, since no review text, star counts, or reviewer names were present anywhere in the extraction and inventing any would violate "never invent ... facts."

- **Band 8's blueprint `role` is `"testimonial"` (confidence 0.8) but its geometry (`columns: 2`, `cardCount: 1`, `buttonCount: 24`, `media.share: 0.48`, `h: 3593`) and the full-page screenshot both show a two-column grid of ~10 short service cards, each with its own button — not testimonial quotes.** I kept `data-role="testimonial"` on the `<section>` (per the instruction to use the blueprint's role), but built the actual content as a service-card grid to match the structural evidence (counts, columns, height) and the screenshot, rather than inventing testimonial quotes that nothing in the extraction supports. This is a role/content conflict the extraction itself doesn't resolve — flagging it as the clearest "semantic evidence" mismatch found in this run.

- **Band 8's target height (3593px) required inflating the service grid to 10 cards** across 2 columns to land within tolerance; the blueprint gives no explicit item count for this band (`cardCount: 1`), so 10 is an estimate back-solved from height ÷ typical card height, not a extracted fact.

- **`odysseycontracting-com-AGENT.md` and `-DESIGN.md` do not state whether "Kumbh Sans," "Adero Medium/Regular/Light/Bold/Semi-Bold," or "Satoshi Variable" are Google Fonts** — they just name the families. With no web tool available to verify, I loaded only "Kumbh Sans" from Google Fonts (my best recollection is that it is genuinely hosted there) and left "Adero \*" and "Satoshi Variable" as named `font-family` values with generic fallback stacks (they are not, to my knowledge, Google-hosted, and Adero in particular is a commercial/paid family). This is unverified and worth a follow-up check with a web tool.

- **Bands with `background.color: null` in the blueprint** (bands 3, 6, 9, 11, 12) were rendered on the page's default white surface (`surface.page` = `#ffffff` from the token file) since no colour was extracted for them and no fallback was specified in the brief.

- **`-variables.css` contains hundreds of Avada/WordPress-preset variables** (`--awb-*`, `--wp--preset--*`, HSL decompositions, etc.) beyond the "Original Site Variables" block; these look like theme boilerplate rather than page-specific design decisions, so the rebuild's token set was built from the design-tokens JSON and the top ("Colors / Typography / Layout / Spacing / Radius / Shadow") section of `-variables.css` only.

- **Breakpoints in `-DESIGN.md`** are literally listed as `[object Object]px` repeated 20 times — a serialization bug in the extractor, not usable data. The brief fixes the design viewport at 1280px, so this wasn't needed, but it means no responsive breakpoint data exists in the extraction at all.

- **No poster image was recorded for the hero `<video>`** in the blueprint (`background.hasVideo: true` but no poster field), so the `<video>` element has no `poster` attribute; the browser will show a blank/first-frame state until the (unfetched, remote) `.webm` loads.

## Fix log

- **Revision 2:** `[data-reveal]` was opacity:0 by default and relied on a real scroll to ever trigger IntersectionObserver, so a no-scroll full-page capture showed most of the page (everything below ~800px) as blank; fixed `styles.css`/`app.js` so content is visible by default and only elements already on screen at load get a hide-then-fade treatment, guaranteeing correct content with no scroll required.

## Output

- `benchmarks/rebuild/odyssey-round-1/index.html`
- `benchmarks/rebuild/odyssey-round-1/styles.css`
- `benchmarks/rebuild/odyssey-round-1/app.js`
