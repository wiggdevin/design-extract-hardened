# Reviewed scope

The exact branch comparison is in diff.txt and ref.txt. Prompt/injection and untrusted-input review follows agent-prompt, prompt-pack, agent-rules, Markdown, MCP resources/tools and the common prompt-data projector. The independent verifier reproduced and rechecked Markdown and MCP gaps.

Authorization review covers disabled bot event/secrets paths, removed Windows shell integration, npm lifecycle policy, immutable Actions and local-code Smithery execution. Secret scanning covers the exact recorded commit range, not unrelated machine files.

No authentication system was added or changed. Production quota checks now deny requests pending an authenticated/private atomic quota backend. Cache reads and public discovery cannot return historical objects through these source paths. This does not revoke historical object URLs.

Export review is in export-review.md and SECURITY.md. Existing browser SSRF and generated-code protections are preserved and re-exercised. Container runtime and uninstalled companion runtimes are explicitly unverified; no failing or unavailable check is counted as a runtime pass.
