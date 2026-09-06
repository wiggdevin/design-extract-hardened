> Hardened fork: VS Code integration and packaged VSIX removed. Do not publish the historical extension instructions below.

# designlang — Distribution Submission Playbook

Submit each marketplace below. All listing copy + manifests are pre-written.
Review queues take 1–7 days; this playbook is everything you need to click "submit".

---

## 1. Figma Community (`figma-plugin/`)

**Goal:** publicly listed in the Figma Community plugin store.

**Steps:**
1. Open Figma Desktop → Community → Publish a plugin.
2. Upload from local: `figma-plugin/`.
3. Use the title, tagline, description, tags, and cover-image brief from `marketplace/figma-listing.md`.
4. Screenshots: take 4 from the live extraction studio.
5. Submit. Review queue: 3–7 days.

---

## 2. Cursor — Custom Tool listing

**Goal:** Cursor users can `Cmd+Shift+P → designlang: Extract` from any URL.

**Steps:**
1. Read `marketplace/cursor-listing.md`.
2. The provided `mcp.json` snippet is what users paste into `~/.cursor/mcp.json`.
3. We don't submit to Cursor's marketplace directly (no formal review process yet);
   the MCP integration is documented and self-served. Promotion = blog post + tweet.

---

## 3. VS Code Marketplace (`vscode-extension/`)

**Goal:** publicly listed at marketplace.visualstudio.com/items?itemName=designlang.

**Steps:**
1. Install `vsce` once: `npm install -g @vscode/vsce`.
2. From `vscode-extension/`: `vsce package` → produces `.vsix`.
3. Create publisher account: <https://marketplace.visualstudio.com/manage>.
4. `vsce publish` (or upload the `.vsix` via the dashboard).
5. Use the listing copy from `marketplace/vscode-listing.md`.
6. Review queue: ~24h.

---

## 4. Claude Code Skill registry

**Goal:** designlang appears in the official Claude Code skills list.

**Steps:**
1. Read `marketplace/claude-code-skill.md` — it contains the SKILL.md the registry expects.
2. The SKILL.md is already emitted by `designlang <url> --emit-agent-rules` at
   `.claude/skills/designlang/SKILL.md`. We submit a copy at the project root for discovery.
3. Open a PR against <https://github.com/anthropics/claude-code-skills> (or the
   then-current registry repo) — title: "Add: designlang skill".

---

## 5. Raycast Store (`raycast-extension/`)

**Goal:** designlang as a one-keystroke Raycast command.

**Steps:**
1. Read `marketplace/raycast-listing.md`.
2. From `raycast-extension/`: follow Raycast's contribution guide
   <https://developers.raycast.com/basics/publish-an-extension>.
3. PR to <https://github.com/raycast/extensions>.
4. Review queue: 5–14 days.

---

## 6. Chrome Web Store (`chrome-extension/`)

**Goal:** one-click extract from any tab via the Chrome toolbar.

**Steps:**
1. Read `marketplace/chrome-listing.md`.
2. Zip `chrome-extension/`: `cd chrome-extension && zip -r ../designlang-chrome.zip .`.
3. Upload at <https://chrome.google.com/webstore/devconsole>. ($5 one-time dev fee.)
4. Review queue: 1–3 days.

---

## Sequencing

Do them in this order — easiest payoff first, most setup last:
1. **Cursor MCP** (no review, just docs + tweet — ship today).
2. **Chrome Web Store** ($5 fee, 1–3 day review — submit today).
3. **VS Code Marketplace** (free, ~24h review — submit today).
4. **Figma Community** (free, 3–7 day review — submit today).
5. **Claude Code Skills registry** (PR-based, async — submit this week).
6. **Raycast Store** (PR-based, 5–14 day review — submit this week).

Total click-time across all six: ~90 minutes. The wall-clock for everything to be live: ~2 weeks.
