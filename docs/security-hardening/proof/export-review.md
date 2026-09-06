# Export review

Source paths for Vercel Blob extraction cache, cache discovery, theatre reels and public rate counters were removed. cache.js and reel.js expose explicit no-persistence compatibility methods. smart.js no longer contains provider selection or an HTTP implementation. The review bot no longer receives events or secrets. Tests install a fetch trap and set a dummy Blob credential; exports remain disabled.

SECURITY.md allowlists operator-invoked public-target extraction through the existing network boundary, local output files and operator-selected stdio MCP. Raw local files are not redacted or safe code; the operator controls retention and must review before onward disclosure or execution. Agent-facing output receives the bounded projector. No page content can authorize an external recipient or tool.

The composite GitHub Action defaults comments off. A repository-owned workflow may explicitly enable a comment to its own PR with a scoped token; it must review extracted diff content before enabling publication. This session did not execute that export. GitHub's repository/issue context fixes the recipient; no arbitrary third-party workflow gets credentials.

Existing deployed Blob objects, old bot grants, public gallery samples and unrelated hosted analytics were not operationally audited or removed. Their existence or absence cannot be determined from this local source review. The recommendation is limited to local foundation development, not hosted deployment.
