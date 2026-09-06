# Independent HIGH verification

Reviewed 2026-09-06 at HEAD `ca6f2111b5d5a459efc6a9b51ef9caab4abba58a` on `hardened`, against baseline `aa27bd11cab95d5235ba90b5c82e6c9baddceb7e`. Parent is concurrently changing MEDIUM files; those are outside this verdict. This reviewer did not implement these fixes. Read machine AGENTS and verifier skill. No installation, lifecycle hooks, paid APIs, network probes, publishing or live source modifications occurred.

| Criterion | Result | Evidence |
| --- | --- | --- |
| Agent prompt, prompt pack and rules exclude hostile raw strings | PASS | Specified tests: 6 passed, 0 failed, 0 skipped, exit 0. Hostile title, URL, font, voice and anatomy marker absent. |
| Markdown remains usable after sanitization | FAIL | Valid minimal design including colors.gradients:[] throws `Cannot read properties of undefined (reading 'length')` at src/formatters/markdown.js:103. promptData removes gradients before unconditional length access. Other removed required fields include contexts, headings, tags, transitions and keyframes. CLI bin/design-extract.js:373, website/lib/build-files.js:34 and src/api.js:78 invoke this formatter. |
| All AI-targeted channels block raw prompt injection | FAIL | src/mcp/resources.js serializes primitive tokens unchanged; src/mcp/tools.js search_tokens returns original font-family values. A fontFamily value containing hostile system instructions retained PRIVATE_MARKER in resource and tool output. get_region and get_component also retained planted arbitrary text. JSON serialization alone does not isolate instructions from consuming models. |
| Blob cache, public discovery, reels and LLM exports disabled | PASS | Helpers exercised with ambient Blob token and fetch trap; no requests occur and reads/listing return null/empty. Smart keys cannot enable exports. Source helpers contain no outbound calls. Historical remote objects are not deleted by this local change. |
| Public quota behavior fails closed | PASS | NODE_ENV=production checkRateBlob returns allowed:false. Production extraction is deliberately disabled until an authenticated atomic quota backend exists. |
| External bot cannot receive comment input or credentials | PASS | Only workflow_dispatch, permissions:{}, fixed echo step; no action invocation or external bot trigger. Regression passed. |
| Unsafe VS Code integration removed | PASS | Entire vscode-extension path and bundled VSIX absent. Remaining references are historical changelogs, packaging exclusions and marketplace docs prefaced with removal warnings. |
| Plant-and-catch exercises prompt defense | PASS | In-memory module mutation removed only sanitizer assignment from agent-prompt.js. Current output excluded PRIVATE_MARKER; mutated output retained it. No live file altered. |

Executed independently:

```text
node --test tests/prompt-security.test.js tests/export-security.test.js tests/integration-security.test.js tests/smart.test.js
6 tests, 6 passed, 0 failed, 0 skipped; exit 0
```

Node MODULE_TYPELESS_PACKAGE_JSON warnings occurred for website helper imports.

Additional controlled Node reproduction:

```text
MARKDOWN FAIL: Cannot read properties of undefined (reading 'length')
MCP RESOURCE marker retained: true
MCP COMPONENT marker retained: true
MCP REGION marker retained: true
MCP TOKEN marker retained: true
CURRENT agent marker blocked: true
MUTANT agent marker caught: true
```

Highest-priority fix: apply deliberate safe projection to MCP resources and tools, with hostile-font/token regressions. Repair the Markdown projection/formatter contract with a complete valid-design regression. Do not restore unrestricted strings merely to pass old assertions. Existing focused tests omit Markdown and MCP and cannot establish closure of SEC-003.

A report-writing shell command was rejected by an automatic hook because prose coincidentally matched its protected credential-path pattern. No credential access was attempted. The report was written with the purpose-built patch tool.

Initial verdict: FAIL (superseded by the independently verified corrections below).

## Correction recheck

Rechecked at `1f7a264873c5dab7b577fee44577ab01e282b412`. This section supersedes the two initial failures, preserving their evidence above.

| Criterion | Result | New evidence |
| --- | --- | --- |
| Markdown formats complete legitimate extraction without raw injection | PASS | Representative full fixture formats and retains measured #0066cc; hostile metadata, gradient, font, issue prose and component-key tests pass. Four historical expectations were deliberately changed to require omission of raw URL, title, CSS names and prose. Source inspection confirms retained string values remain bounded by allowlists or numeric grammars. |
| MCP resources/tools omit arbitrary raw text | PASS | buildResources and buildTools now project both design and tokens before consuming data. New tests cover hostile region heading, component text, font values and token keys. Controlled f0 font-token payload is blocked by current code and reappears after removing only the token projection in an in-memory mutant. |
| MCP retains safe generated token identifiers | PASS | s0/r0/f0 fixture survives projection; independently ran real formatDtcgTokens followed by search_tokens and received spacing.s0=4px and spacing.s1=8px. |
| Original SSRF and generated-code injection tests remain green | PASS | network-safety, clone-security and url-safety included in independent rerun: zero failures or skips. |
| Other HIGH fixes continue to pass | PASS | Export, integration and smart regressions rerun alongside corrected prompt tests. Untrusted companion files are no longer called ground truth or recommended for unchecked importing in agent prompt. |
| Immutable Action provenance | PASS | Independently queried owning GitHub repositories using git ls-remote. SHA matches: checkout 3d3c42e5... = v7.0.1; setup-node 249970729... = v6.5.0; github-script f28e40c7... = v7.1.0; fetch-metadata 25dd0e34... = v3.1.0; CodeQL cdf488f5... = peeled v4.37.9. Static test checks every uses reference is a 40-character SHA. |
| qs moderate findings | PASS | Installed qs reports 6.16.0. Bracket/comma array-limit regression throws RangeError; controlled isBuffer constructor round-trip no longer throws. |
| Mutable installation paths | PASS | Static regression confirms root has no install/prepare lifecycle scripts, dependency versions match lock, registry entries have integrity, .npmrc disables scripts, and Action/Smithery contain no npx/global mutable install. No installation was run by this verifier. |
| Smithery non-root source configuration | PASS | Pinned base digest, reviewed local code, ignore-scripts npm ci, USER node before installation and runtime. Reviewer caught root-owned /app issue; final Dockerfile now creates and chowns /app before USER node. |

Independent command (exit 0):

```text
node --test tests/prompt-security.test.js tests/export-security.test.js tests/integration-security.test.js tests/smart.test.js tests/mcp.test.js tests/formatters.test.js tests/dependency-security.test.js tests/network-safety.test.js tests/clone-security.test.js tests/url-safety.test.js
194 tests, 194 passed, 0 failed, 0 skipped; 36 suites
```

Additional independent mutation result: current MCP projection blocks hostile font marker; removing only that projection in an in-memory module emits it. Complete Markdown fixture retained its measured color. Both assertions passed with exit 0.

UNVERIFIED: Docker image build and container runtime. `docker info` failed because the configured OrbStack socket does not exist; no daemon was started and no image or dependencies were installed. Browser extraction and hosted deployment are outside this verifier's execution scope; parent owns full-suite and other runtime reporting. This is a scoped HIGH plus MEDIUM source/regression verification, not a production-deployment approval.

Remaining limitations: arbitrary raw artifact files remain untrusted when read directly; allowlisting intentionally removes custom font names, custom token keys and prose in AI channels. Hosted quotas deny production requests until private authenticated quota infrastructure exists. Existing public remote objects and credentials require separate owner action; local source changes do not revoke/delete them.

VERDICT: PASS (HIGH fixes and requested executable/static rechecks; Docker runtime explicitly UNVERIFIED)

## Final report accuracy verification

Read-only review at source `0ec70bc7a0e30b3ab1dad52773b08e6b4cbd0bf7`: inspected this directory's README and security-review.json, all three audit JSON files, full-core and website-library test summaries, signature evidence, Raycast source/manifest/lock and disabled setup installation. No dependencies were installed or companion runtime launched.

| Claim | Result | Evidence |
| --- | --- | --- |
| Overall certification remains stopped | PASS | README says runtime certification STOPPED; JSON verdict is STOPPED and SEC-009 is STOPPED with UNAVAILABLE recheck. Container runtime is not represented as passing. |
| Reported test and provenance counts agree with artifacts | PASS | full-tests.txt ends 646 pass/0 fail/0 skip; website-tests.txt ends 58 pass/0 fail/0 skip; npm-signatures.txt records 120 verified signatures and 11 verified attestations. These artifact checks are not claims of a second independent full-suite execution. |
| Three recorded lock audits are clean | PASS | Parsed npm-audit.json, website-audit.json and raycast-audit.json: each vulnerability total is 0. |
| Final dependency regressions execute successfully | PASS | Independently ran `node --test tests/dependency-security.test.js`: 6 tests pass, 0 fail, 0 skipped; exit 0. |
| Raycast avoids shell-based execution and mutable package download | PASS | Extract/score use execFile with argument arrays and local designlang executable; copy-cli uses single-quote escaping. Four harmless shell-quote probes containing apostrophe, command substitution, backticks and semicolon retain the exact URL with exit 0. No clipboard action or actual CLI invocation occurred. |
| Raycast resolved graph pins patched dependencies | PASS | Vulnerable typescript-estree minimatch branch locks 9.0.7; esbuild locks 0.28.1. Every non-root lock entry has registry.npmjs.org resolution and sha512 integrity. This checks lock data, not package execution. |

Two minor documentation/retirement inconsistencies were communicated to the implementer: Raycast README/manifest descriptions still mention npx despite the local CLI implementation; dev-setup.sh disables installation only after cloning/updating a mutable fork. Neither demonstrates a remaining HIGH exploit; retiring setup before its side effects is preferable. Raycast local executable resolution depends on the user's PATH and must point to the reviewed CLI. Companion type/lint/build/runtime and Docker runtime remain explicitly unverified.

Scoped report-accuracy result: PASS. This does not change the security report's overall STOPPED verdict or certify the blocked container.

### Raycast retirement recheck

At `68330fa01fcdd9a9de22df3f60397f485b3ed490`, static inspection confirms dev-setup.sh contains only set-eu, a retirement message and exit 1. It performs no clone, checkout, reset, installation or runtime launch. README command descriptions and manifest clipboard description now name the local designlang command. Independently reran dependency-security.test.js, including the retired-script assertions: 6 pass, 0 fail, 0 skipped, exit 0. The setup side-effect concern is closed. README's remaining npx prerequisite and plain-install publishing example were identified to the parent for wording alignment; these are documentation issues, not executable injection paths.

## Coordinator documentation follow-up

After the verifier's last static check, the remaining Raycast README prerequisite was changed to “Reviewed local `designlang` on PATH”; its install example now uses `npm ci --ignore-scripts`. This is a coordinator-recorded documentation correction, not an additional independent runtime verification. The source/runtime verdict and Docker limitation are unchanged.
