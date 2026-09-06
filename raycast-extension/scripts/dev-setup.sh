#!/usr/bin/env bash
# designlang Raycast extension — dev setup for screenshot capture.
#
# Run this once. It clones the PR branch into ~/raycast-dev/extensions,
# installs deps, and starts Raycast's dev mode so you can capture
# the four metadata screenshots.

set -euo pipefail

DEV_ROOT="${HOME}/raycast-dev"
REPO_DIR="${DEV_ROOT}/extensions"
EXT_DIR="${REPO_DIR}/extensions/designlang"
BRANCH="add-designlang-extension"
FORK_URL="https://github.com/Manavarya09/extensions.git"

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }
ok()     { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn()   { printf '\033[33m!\033[0m %s\n' "$*"; }

# ── 1. Sanity checks ────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || {
  warn "This script only runs on macOS — Raycast is Mac-only."
  exit 1
}
command -v git  >/dev/null 2>&1 || { warn "git is required.";  exit 1; }
command -v node >/dev/null 2>&1 || { warn "Node ≥ 18 is required."; exit 1; }
command -v npm  >/dev/null 2>&1 || { warn "npm is required.";  exit 1; }
[[ -d "/Applications/Raycast.app" ]] || warn "Raycast.app not found in /Applications. Install from https://raycast.com first."

bold "designlang Raycast — dev setup"
dim  "(working in ${DEV_ROOT})"
echo

# ── 2. Clone or update the fork ─────────────────────────────────
mkdir -p "$DEV_ROOT"
if [[ -d "$REPO_DIR/.git" ]]; then
  ok "Fork already cloned, updating ${BRANCH}…"
  git -C "$REPO_DIR" fetch --depth=1 origin "$BRANCH"
  git -C "$REPO_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  ok "Cloning fork (shallow, single branch — ~50MB instead of GBs)…"
  git clone --depth=1 --single-branch --branch "$BRANCH" "$FORK_URL" "$REPO_DIR"
fi

# ── 3. Install deps ─────────────────────────────────────────────
cd "$EXT_DIR"
ok "Installing dependencies…"
echo "Automatic installation disabled: review and lock Raycast dependencies first."
exit 1

# ── 4. Open Raycast (so dev-mode can register) ──────────────────
if [[ -d "/Applications/Raycast.app" ]]; then
  ok "Bringing Raycast forward…"
  open -a Raycast
  sleep 1
fi

# ── 5. Tell the user exactly what to do ─────────────────────────
echo
bold "Setup complete. Now in this same terminal, run:"
echo
echo "    cd $EXT_DIR"
echo "    npm run dev"
echo
bold "Then in Raycast:"
cat <<'STEPS'

  1. ⌘ + Space    →    Window Capture   (Raycast's built-in)
                       — captures 1600×1000 PNG with proper Raycast chrome
                         and saves to ~/Desktop

  2. Open these 4 designlang views one at a time and capture each:
       a)  Extract Design From URL  → empty form
       b)  Extract Design From URL  → mid-extraction (after submit, while toast is animating)
       c)  Score Website Design     → result card with grade
       d)  Copy CLI Command For URL → URL argument prompt

  3. Move the 4 PNGs into the local repo so they get pushed:

       mkdir -p ~/claude-plugin/design-extract/raycast-extension/metadata
       mv ~/Desktop/<the-4-pngs> ~/claude-plugin/design-extract/raycast-extension/metadata/
       # rename to designlang-1.png ... designlang-4.png in display order

  4. Tell Claude "screenshots ready" and Claude pushes them to the PR.

STEPS
echo
dim "(press Ctrl+C to stop npm run dev when you're done capturing.)"
