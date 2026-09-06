> Hardened fork: VS Code integration and packaged VSIX removed. Do not publish the historical extension instructions below.

# VS Code Marketplace — designlang listing

## Display name

designlang — Extract any website's design system

## Description (short, max 200 chars)

CLI + MCP + VS Code commands that reverse-engineer any URL into DTCG tokens, Tailwind, CSS vars, Figma variables, and an agent-native DESIGN.md. $0, MIT, no account.

## README (long description)

The README at the root of `vscode-extension/` is what the marketplace renders. Make sure it covers:

1. **What it does** — paste a URL, extract a design system, import into the active workspace.
2. **Commands** —
   - `Designlang: Extract from URL` (Cmd+Shift+P)
   - `Designlang: Apply to Workspace` (writes Tailwind + CSS vars next to the user's existing files)
   - `Designlang: Open DESIGN.md`
   - `Designlang: Compare with Production` (drift bot inside the editor)
3. **MCP integration** — point at the same `npx designlang mcp` server, gets the live extraction.
4. **Screenshots** — the streaming token paint inside the VS Code panel.

## Categories

Programming Languages, Other, Visualization, AI

## Tags

design-system, design-tokens, dtcg, w3c, tailwind, figma, css, ai, mcp, claude, cursor

## Pricing

Free.

## License

MIT — link to the LICENSE file at the repo root.

## Repo

https://github.com/Manavarya09/design-extract

## Publisher

`designlang` (matches package.json `name`)
