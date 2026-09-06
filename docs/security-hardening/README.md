# Security hardening continuation — 2026-09-06

**Source fixes verified; overall runtime certification STOPPED.** All four known HIGH findings are fixed. The install-chain and qs MEDIUM findings are fixed. Smithery's root-user configuration is fixed in source and covered by a regression, but its container build/runtime remains blocked because the Docker daemon is unavailable. This is not a production-readiness certificate.

Started from a clean `hardened` checkout at `aa27bd11cab95d5235ba90b5c82e6c9baddceb7e`. Reviewed implementation ref and exact comparison appear in `security-review.json`. All changes are local. No push, PR, publication, deployment, external message, paid model call, or untrusted lifecycle hook was executed.

## Changes and finding status

| ID | Severity | Status | Change / evidence |
|---|---|---|---|
| SEC-001 | BLOCKER | Preserved fixed | IP-pinned SSRF proxy and hosted URL checks unchanged; original tests pass. |
| SEC-002 | BLOCKER | Preserved fixed | Generated metadata/JSX serialization unchanged; original exploit tests pass. |
| SEC-003 | HIGH | Fixed | Closed-vocabulary, bounded-value projection on prompts, recipes, agent rules, Markdown and MCP. Raw copy, arbitrary fonts, URLs, dynamic names and model prose cannot enter those outputs. |
| SEC-004 | HIGH | Fixed in source | Public Blob cache, discovery/permalinks, reel persistence and public counters removed; LLM network implementation removed. Ambient credentials cannot reactivate exports. Hosted quota checks fail closed. Historical objects remain unverified. |
| SEC-005 | HIGH | Fixed | External review bot disabled; no PR/comment trigger or secrets. All remaining Actions pinned to owner-verified commit SHAs. |
| SEC-006 | HIGH | Fixed | Self-contained VS Code extension, manifest, lock, binaries/VSIX removed. Only historical changelog/retired marketplace references remain. |
| SEC-007 | MEDIUM | Fixed | No postinstall hook; no mutable npx/global install in executable integrations; manifests/locks pinned, scripts disabled by npmrc. Action and Smithery execute this checkout. Raycast calls a local CLI and its automatic setup install is disabled. |
| SEC-008 | MEDIUM | Fixed | qs 6.16.0 override and lock; both original DoS regressions pass. |
| SEC-009 | MEDIUM | Source fixed; runtime blocked | Pinned Node image, owned /app, USER node before installation/runtime; no browser or apt layer. Docker socket unavailable. |
| SEC-010 | HIGH / LOW | Fixed in lock; runtime unverified | Additional Raycast tooling advisories found during lock review: minimatch pinned to 9.0.7 and esbuild to 0.28.1. Audit now clean; companion not installed/built. |

No known HIGH source finding is left open. The formal STOPPED verdict retains SEC-009 as not runtime-certified. Other unverified boundaries below must not be read as passing checks.

## Validation

- Full core suite: **646 passed, 0 failed, 0 skipped** (`proof/full-tests.txt`).
- Website library suite: **58 passed, 0 failed, 0 skipped** (`proof/website-tests.txt`). This is not a Next.js build or route deployment test.
- Focused rechecks are captured separately for each finding (`proof/sec-*-recheck.txt`).
- Syntax: **203 JavaScript/module files passed** `node --check` before the final assertion-only dependency-test addition; that added test was executed successfully (`proof/syntax.txt`, `proof/dependency-tests.txt`).
- Plugin manifest check passed (`proof/plugin-check.txt`); whitespace diff check passed.
- Root, website and Raycast lock audits report **zero known vulnerabilities** (`proof/*audit.json`). Audits are time-specific and do not establish absence of unknown vulnerabilities.
- All **121 root tarballs** were downloaded as data, SHA-512 checked against lock integrity and package manifests inspected before installation (`proof/dependency-provenance.json`). No tarball code was executed by that review.
- Installed using `npm ci --ignore-scripts --omit=optional --no-audit --no-fund`: 120 packages installed. The first clean-install attempt failed safely because qs required side-channel 1.1.1; lock-only resolution and the complete integrity review were repeated before the successful install.
- `npm audit signatures`: **120 registry signatures and 11 provenance attestations verified** (`proof/npm-signatures.txt`).
- Exact implementation-range gitleaks scan passed (`proof/gitleaks.txt`). A final scan covering the report commit is recorded in the delivered copy.
- Independent verifier: **PASS for HIGH fixes and scoped source/regression checks**, 194 tests, zero failures/skips, plus sanitizer-removal mutation checks. It initially reproduced a Markdown crash and MCP injection bypass; both were fixed and independently rechecked (`proof/independent-high.md`). Container runtime was explicitly unverified.

The root project has no configured TypeScript or lint script. Raycast TypeScript/lint and the Next.js build were not run: their dependencies were resolved as lockfile metadata only, not installed. Core syntax checks are not represented as type/lint passes.

## Commands not run or blocked

- No plain install/postinstall, dependency prepare script, `npx` download, global install, browser installer or system-package installer was run.
- No Docker build/run: `docker info` failed because the configured OrbStack daemon socket is absent; no alternate running context was found (`proof/docker-runtime.txt`).
- No website build/start, Raycast build/lint/start or remote Actions execution. Source and local test evidence do not establish those runtime outcomes.
- Initial root `npm audit` failed against a retired quick endpoint with an inconsistent lock. After lock repair it passed through the normal audit command. The failed attempt was not treated as a clean scan.
- No deletion or inspection of existing remote Blob objects, bot permissions, provider retention settings, or production credentials. That would require a separately scoped operational task.

## Recommendation

Do **not** assume a fresh GitHub/npm download contains these fixes: nothing has been pushed. Use the reviewed local `hardened` checkout for controlled foundation development, following `SECURITY.md`. Do not deploy the hosted extractor or treat every companion/generated artifact as certified.

Closed-vocabulary projection intentionally reduces design fidelity (custom font names, source copy, selectors and freeform descriptions are omitted from agent context). It does not replace controls in an external agent. Raw extraction files, generated web code and legacy sample artifacts remain untrusted and must be reviewed before executing, importing or publishing. Browser-engine vulnerabilities and arbitrary generated-artifact safety are outside the demonstrated exploit coverage. Future dependency updates require fresh lock, provenance, regression and advisory checks.
