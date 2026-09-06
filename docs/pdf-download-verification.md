# Independent PDF download verification

Scope: local PDF fix against `0d5a807`; reviewed website PDF renderer, POST route, download button and new regressions. No installation, extraction requests, browser UI interaction, push or app mutation was performed by this reviewer. The user-requested download response to the initiating local browser is the authorized export; remote subresources and script execution are denied.

| Criterion | Result | Evidence |
| --- | --- | --- |
| Installed browser renders valid PDF | PASS | Independently ran tests/website-pdf.test.js with network-safety and export-security: 16 pass, 0 fail, 0 skipped, exit 0. New endpoint test checks PDF signature, attachment header and parses at least one page with pdf-lib. Static Playwright import uses installed runtime rather than mismatched dynamic playwright-core. |
| Actual local HTTP download works | PASS | POST http://localhost:3210/api/pdf with synthetic HTML returned 200, application/pdf, attachment filename verify.example-brand.pdf, %PDF- signature and 19,636 bytes. This was not an extraction request and consumed no extraction quota. |
| Untrusted HTML cannot use prior trusted bypass | PASS | Browser test passes former trusted:true option with hostile script, iframe, external stylesheet/image and footer markup. PDF parses; controlled HTTP listener receives zero requests. Renderer unconditionally disables JavaScript, blocks service workers, sets offline and aborts routed requests. Footer host is HTML-escaped. |
| Bad input fails before rendering | PASS | Non-markup input returns 400; HTML over 4 MiB returns 413. |
| Failure output does not expose browser internals | PASS | POST catch returns a fixed generic retry/download-HTML message. Client ignores raw server error text and renders a fixed alert. |
| Error no longer expands button label | PASS, source only | Button retains Download brand PDF label after failure; alert is a separate element with full-row flex basis. Rendered layout and real user download behavior are delegated to parent's independent browser checks. |
| Existing security boundaries preserved | PASS | Network-safety and export-security checks pass; no dependency changes or reactivation of public storage/remote browser exports in this diff. |

Limitations: offline output uses local fallback fonts and omits remote images; this is an intentional fidelity tradeoff. Parent owns visual layout checks and browser download confirmation. Local POST is unauthenticated and starts a browser; it must not be exposed as a production service without authentication, concurrency/rate limits and ingress body limits. Its existing JSON parsing occurs before the HTML size check, so the limit is not an entire-request streaming memory limit. Container/deployed PDF behavior remains unverified; the prior production/container security report is not upgraded by this local success.

Scoped behavioral verdict: PASS. Formal security-review schema/range-scan validation is recorded separately in pdf-security-review.json after the implementation commit.

Formal review completed for `0d5a807e32bb118e719217fc66e84b43781aef10..dafc307bb442ab929ef654bbb72b53bfcfb0363b`: exact-range gitleaks found no leaks (exit 0); security-review report validator returned `security-review-report: OK` (exit 0). The formal PASS applies to this local PDF change, with production limitations above retained. Parent browser/full-suite artifacts are available in docs/pdf-proof; they were not substituted for the independent focused test and HTTP checks described here.
