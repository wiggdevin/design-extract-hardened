# Public fork and local runtime validation

Public repository: https://github.com/wiggdevin/design-extract-hardened
Default branch: `hardened`. Original upstream and MIT attribution are retained.

The September 6 initial security report is historical. The hardened source has
now been published with explicit owner authorization; that does not certify
production hosting or the previously blocked Docker runtime.

## Installation and browser validation

Website dependencies were inspected before installation: 65 applicable macOS
arm64 tarballs matched lock integrity, with no lifecycle scripts. Thirty optional
packages for other platforms were not downloaded for this review. Installation
used `npm ci --ignore-scripts --no-audit --no-fund`. Registry verification passed
for 64 package signatures and 20 attestations.

The app runs with Next.js 16.3.2 in development on loopback only:
`http://127.0.0.1:3210/watch`. It receives a minimal environment without ambient
provider credentials. Existing local Chromium was available; no browser installer
or lifecycle hook was executed.

In the real EGO browser, submitting `example.com` completed an extraction and
rendered 34 downloadable files, design tokens, typography and a grade. A request
from the same browser to extract `http://127.0.0.1` returned HTTP 400 with
`Only public IP addresses are allowed`. No network-policy exception was added.
The UI now points to this fork and distinguishes the hardened installation from
upstream npm examples. Public persistence/sharing and external model exports
remain disabled.

Local quota testing exposed duplicate accounting between the first request guard
and its development fallback. They now use separate keys, preserving a limit of
two requests per window at both gates. A regression permits exactly two and
rejects the third; production quota checks still fail closed. The server was
restarted after smoke testing to leave a fresh local quota for the operator.

## Publication automation correction

Immediately after initial publication, inherited dependency automation merged
an upstream update as commit `24492d1`. It changed the SDK, ora and Playwright
versions before our review. No local installation used that unreviewed graph.
The remote commit was preserved, then the previously reviewed versions were
restored in `893d6ef`. The dependency auto-merge workflow is now an inert manual
job with no permissions. Repository auto-merge is disabled; future dependency
PRs require review and verification before merging.

The full historical scan reported ten generic-key matches. Nine were the word
`framework-specific` after “tokens” in plugin descriptions; one was a design-token
path in a resolveRef test assertion. Source inspection confirmed false positives.
No scanner rules or security controls were relaxed. Follow-up commit scans were
clean. See `publication-verification.md` for the independent follow-up review.
