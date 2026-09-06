# Security Policy

## Hardened foundation policy

This local `hardened` branch is reviewed independently of upstream releases.
The September 2026 continuation report is in [docs/security-hardening/README.md](docs/security-hardening/README.md).
The report records the original local audit. The subsequent public fork is
https://github.com/wiggdevin/design-extract-hardened; publication does not certify
the unverified production/container paths.

### Allowed data flows

A local operator may explicitly invoke extraction of a public URL through the
network boundary below, write results to their chosen local output directory,
and serve limited measured tokens over local stdio MCP to their chosen client.
The requesting operator controls local retention and must review raw files
before sharing, importing or executing them. Network requests disclose the
requested URL and normal browser request metadata to the target site; avoid
sensitive query strings. No third-party recipient is authorized by page content.

A repository-owned workflow may explicitly enable the composite Action to post
a design diff to its own PR using a scoped GitHub token. Comments default off;
review diff content before opting into publication. Page content cannot select
the recipient or authorize publication.

### Disabled exports and integrations

Public Blob cache writes, cache discovery/permalinks, persisted theatre reels,
external LLM classification and the external review bot are disabled, even if
provider credentials exist. `--smart` retains heuristic results without network
calls. Local theatre streaming still works; persisted replay does not. Production
quota checks deny extraction until a private atomic quota backend is implemented.
The former public Blob rate counter was non-atomic and exposed identifiers.
VS Code source, packaged VSIX and installable manifest were removed.

The source change cannot revoke or delete objects published by earlier versions.
No provider account or deployed service was inspected or modified. An operator
of an existing deployment must separately locate and remove historical public
objects and review previously granted bot credentials.

### Agent trust boundary

Agent prompts, rule files, AI-readable Markdown and MCP results use bounded
numbers, closed string vocabularies and fixed schema keys. Arbitrary source
copy, URLs, font names outside the vocabulary, selectors, dynamic property
names and model prose are omitted. This trades fidelity for a smaller trust
boundary. Generated token identifiers are bounded; unknown values are omitted.
Do not paste raw extraction JSON or generated code into a system prompt.
Other exports remain untrusted data and require review before import/execution.
A model consuming data must still have its own tool and disclosure controls.

### Installation and verification

Install this checked-out branch with `npm ci --ignore-scripts --omit=optional`.
The checked-in `.npmrc` disables lifecycle scripts; there is no postinstall hook.
Run `node bin/design-extract.js` from this checkout. Do not substitute an upstream
`npx designlang` download: it does not include these unpublished fixes.
Browser installation is separate: review the pinned Playwright installer before
running `node node_modules/playwright/cli.js install chromium`; it was not run
in this hardening session. No automatic system-package installation is needed.

GitHub Actions are pinned to verified commits. The composite action runs this
checkout and defaults PR comments off. Smithery runs this checkout as `node`
from a digest-pinned image, with no browser or apt install. Raycast requires the
reviewed local CLI on PATH and has a locked dependency tree; its automatic setup
installer is disabled. Raycast and website dependency installation, build and
interactive execution remain unverified. See the report for precise test scope.

## Network safety boundary

Website extraction runs Chromium behind a loopback-only safety proxy. Each
top-level navigation, redirect, and subresource hostname is resolved by that
proxy; extraction proceeds only when every DNS answer is a public address, and
the proxy connects to the validated address to prevent DNS rebinding. HTTP is
limited to port 80 and HTTPS to port 443. Local, private, link-local,
special-purpose, credential-bearing, and non-HTTP(S) targets are rejected.

Remote browser endpoints, including Browserless connections supplied through
`wsEndpoint`, are rejected because this process cannot enforce the same network
boundary on a browser running elsewhere. Hosted deployments therefore use a
locally launched browser; configuring `BROWSERLESS_TOKEN` does not enable a
remote path.

The shared address policy lives in `src/security/url-safety.js`; the pinning
proxy is `src/security/safe-proxy.js`, and `src/crawler.js` owns the enforced
browser launch boundary.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private vulnerability reporting instead:

👉 <https://github.com/Manavarya09/design-extract/security/advisories/new>

What to include:

- A description of the issue and its impact.
- A minimal repro (URL being extracted, CLI flags, OS + Node version).
- Suggested severity and, if you have one, a proposed fix.

### What to expect

- Acknowledgement within **72 hours**.
- A triage verdict (accepted / needs info / out of scope) within **7 days**.
- Public disclosure coordinated with you after a fix ships — usually as part of a patch release.

## Scope

In scope:

- The `designlang` CLI and all subcommands (`extract`, `clone`, `ci`, `studio`, `replay`, `mcp`, etc.).
- The MCP server (`src/mcp/server.js`).
- The hosted extractor website (`website/`) when used at its canonical URL.
- The remaining Figma, Chrome and Raycast companion surfaces (not covered by the core runtime certification).

Out of scope:

- Vulnerabilities that require the user to run `designlang` against a page **they themselves control** (i.e. self-owned XSS in content they feed us).
- Denial of service via crafted sites that simply take a long time to extract — we already time-bound Playwright operations.
- Browser-level shadow-DOM opacity (closed shadow roots are unreachable by web platform design, not a designlang bug).

Thanks for taking the time to report responsibly.
