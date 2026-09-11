# Build notes: Odyssey Contracting rebuild (round 2)

## Files read

All reading was limited to `benchmarks/results/rebuild-round-2/odyssey-extract/`, as required. Files actually used:

- `odysseycontracting-com-blueprint.json` (band structure, bounds, repeats, media, headings)
- `odysseycontracting-com-design-tokens.json` (colour, spacing, radius, shadow, font tokens)
- `odysseycontracting-com-variables.css` (CSS custom property names and values)
- `odysseycontracting-com-DESIGN.md` (colour dominance, typography scale, do's and don'ts)
- `odysseycontracting-com-AGENT.md` (brand summary, build rules, voice/CTA verbs)
- `odysseycontracting-com-motion-tokens.json` and `odysseycontracting-com-motion.css` (durations, easing, keyframe names)
- `odysseycontracting-com-voice.json` and `odysseycontracting-com-intent.json` (tone, section roles, cross-check for band content)
- `odysseycontracting-com-gradients.css` (overlay gradient values used on card images)
- `odysseycontracting-com-reset.css` (base element reset, used almost verbatim)
- `odysseycontracting-com-design-language.md` (skimmed, no new facts beyond DESIGN.md)
- Screenshots: `full-page.png`, `nav.png`, `hero.png`, `card-default-0/1/2.png`, `button-default-0/1-large-0.png`, `responsive/desktop-light.png` (viewed as images for layout/colour confirmation only; not used as a source of verbatim copy)

Not opened: any file outside the extract directory, `.brand.pdf`, `.tailwind.config.js`, `-theme.js`, `-tokens.d.ts`, `-shadcn-theme.css`, `-wordpress-theme.json`, `-mcp.json`, `-figma-variables.json`, prompts folder. These were redundant with the files above for this task.

## Structural decisions and why

- **Bands 1 and 2 share one wrapper.** `blueprint.json` marks band 1 (hero video, `overlay: true`) and band 2 (content, `overlay: false`) with nearly identical bounds (`0,0,1280,800` and `6,0,1269,800`). Read literally, "positioned on top of the band before it" would stack band 1 on band 0 (the 107px nav), which cannot hold an 800px video without clipping it. Instead band 1 is layered as the absolute-positioned background inside a `position: relative` wrapper sized to 800px, with band 2 stacked on top at the same footprint. Both bands still exist as their own `<section data-band="1">` / `<section data-band="2">`, in order.
- **Band 0 (nav) is `position: fixed`,** the explicit alternative the task gives for a fixed nav. Its recorded `background.color` is `#000000`, but the nav screenshot clearly shows the hero image through the bar, so a fully opaque black bar would contradict the visual evidence. Rendered instead as a black-to-transparent gradient over the fixed bar. This is a judgment call the extraction did not resolve (no alpha channel was recorded for the nav background).
- **Band 2's hero content is nearly empty in the data** (`heading.text: ""`, `textLength: 0`, `buttonCount: 2`). Two controls fit the description of prev/next arrows on a Fusion-theme video hero, so band 2 became a minimal `data-slider` with the real video as its only slide and functioning-but-inert prev/next buttons (see below). The H1 is rendered visually hidden (`sr-only`) with short placeholder text, since there is no verbatim text to show and no visible on-image headline in the screenshot for this exact band.
- **`data-slider` has only one real slide.** The extraction gave exactly one hero media asset (the `.webm`). The slider markup and JS logic are generic and would page through multiple `.slide` elements if more existed; with one slide the prev/next buttons are rendered but disabled by `app.js`, which is more honest than inventing a second slide image that was never extracted.
- **Cards without a `repeats` field are not grid-generated.** Only bands 8, 10 and 13 carry a `repeats` object, so only those got an exact card count (10 at 624x616 / 2 per row; 3 at 416x426 / 3 per row; 3 at 312x238 / 3 per row) as instructed. Band 5's `cardCount: 40` and band 11's `cardCount: 9` have no `repeats` field, so they were built from the band's `columns` value and the visible structure in the screenshots (a 2-card comparison, a short FAQ accordion) rather than forced into an arbitrary 40- or 9-item grid the data does not actually specify the shape of.
- **Footer column count.** `blueprint.json`'s `repeats` for band 13 says `count: 3`, but `responsive/desktop-light.png` shows four footer columns (About Us / Remodeling Services / Project Gallery / Locations) on the live site. The build follows the structured `repeats` field literally (3 columns) since that is the field the task designates as authoritative for grid shape, and this note flags the visible discrepancy rather than silently reconciling it.

## Copy

- The only verbatim text used is `heading.text` where `blueprint.json` supplied a non-empty string: band 5's "The Industry Reality vs. The Odyssey Standard", band 13's "ABOUT US", band 14's "Address".
- For bands whose largest heading was legible in an allowed screenshot but blank in `heading.text` (bands 4, 7, 8, 9, 10, 11), the visible heading was used as-is because it is real, confirmed text rather than an invented one: "Odyssey Contracting - The Trusted Home Remodeling Company in Raleigh", "Ratings & Reviews" (its length, 17 characters, matches `textLength: 17` on that band exactly), "Home Remodeling Services", "Professional Installation and Superior Results", "Explore Some of Our Featured Projects", "Frequently Asked Questions About Odyssey Contracting".
- Every other string (paragraph copy, card titles inside repeated grids, checklist items, comparison-card copy, FAQ answers, footer link labels) is placeholder copy written to a similar length and tone to what the screenshots show, deliberately reworded rather than transcribed, per the brief. Specific claims visible on the real cards (a "5-year workmanship warranty", a "5-step process") were intentionally not reproduced, since they read as prices/guarantee terms this rebuild cannot verify.
- No phone number, street address, or price was invented anywhere. Band 14's "Address" heading is followed by an explicit placeholder sentence stating the address was not part of the extraction, rather than a fabricated one. The footer's third column avoids naming any service-area city.

## Tokens

- Colours, spacing (`--s0`...`--s8`), radii, and the single shadow token all come from `design-tokens.json` / `variables.css`.
- Typography: `DESIGN.md` and `AGENT.md` disagree on the heading font (`AGENT.md`/DESIGN.md list "Adero Semi-Bold" as the heading family, but `reset.css` sets `h1`-`h6` to `"Kumbh Sans"`, and neither "Adero" nor "Satoshi Variable" is a Google font that can be linked). Kumbh Sans is used for both body and headings, matching `reset.css` and the rounded geometric sans visible in every screenshot. This is called out because the tokens files do not agree with each other.
- Kumbh Sans is loaded via a Google Fonts `<link>` because it is a real Google font family named directly in the tokens. Adero and Satoshi Variable are not loadable this way and are not linked; the reset's system-sans fallback stack covers them.
- The one gradient overlay used on the service/project card images reuses `--grad-3` / `--grad-2` values verbatim from `gradients.css`.
- Motion: `motion-tokens.json` records durations (100/200/300/500ms) and one custom cubic-bezier, but every band's own `reveal` field in `blueprint.json` is `null`, so there is no per-band reveal timing to honour. The 500ms duration and the recorded custom cubic-bezier were used globally for the reveal-on-scroll transition and the slider's crossfade, since those are the only durations/easings the extraction actually ties to motion.

## Bands not fully reproducible

- **Band 0 (nav):** `buttonCount: 9` is recorded but only 4 nav links + 1 CTA (5 interactive elements) are visible in `nav.png` / `full-page.png`. The remaining 4 are undocumented (possibly a mobile toggle and social icons not visible in the captured crop) and were not invented.
- **Band 5 (comparison):** `cardCount: 40` has no accompanying structural data (no `repeats`, no sub-band list) to say what the other ~36 "cards" beyond the two comparison panels are. Rendered as the two panels the screenshots confirm.
- **Band 7 (reviews):** `media.kind: "embed"` with a widget URL. Per the brief this is rendered as a labelled placeholder block, not a live embed; its real height/behaviour when actually loaded is unknown from the extraction.
- **Band 8 (10 service cards):** only one image URL (`Addition-and-deck.jpg`) was extracted for the entire 10-card grid, and `withImage: 10` says all ten have imagery. All ten cards reuse that single URL as a background image; the other nine images were not recovered by the extraction.
- **Band 10 (3 project cards):** same limitation, one image URL (`1-7.jpg`) for all three cards despite `withImage: 0` (no `<img>` tag was detected, consistent with a CSS background-image implementation, which is what was built).
- **Band 9 and 12:** neither has a `heading.text` value and neither heading was clearly legible at the screenshot's resolution, so both headings are placeholder copy of roughly the recorded `textLength`, not reconstructed real text.

## Viewport

Built and laid out for a fixed 1280px canvas (`html, body { min-width: 1280px; overflow-x: hidden; }`), per the brief. No responsive breakpoints were added since none were requested.

## Fix log

- Revision 2 (controller): the reveal script armed a hidden state for every data-reveal element and revealed only what intersected, so a full-page capture with no scroll showed empty colour blocks below the fold. Now only elements on screen at load are hidden (reveal-pending) and faded in; everything below the fold is visible from the start.
