# Independent publication follow-up verification

Reviewed 2026-09-06 at `893d6efdb400b7c622f63bdb5f2f771817c40fbc`, plus the uncommitted local quota correction in website/lib/rate-limit.js and its regression test. The implementer owns subsequent UI/documentation changes and final publication. This reviewer performed read-only checks and wrote only this report; no install, push, extraction request, browser interaction or repository-setting mutation occurred.

| Check | Result | Evidence |
| --- | --- | --- |
| Reviewed dependency graph restored after inherited automation update | PASS | `git diff c5dcb85 -- package.json package-lock.json` produced no output. History retains 24492d1 followed by restoring commit 893d6ef; no history rewrite is implied. |
| Installed root package versions match restored lock | PASS | Compared every installed package manifest version against package-lock.json: zero mismatches. Only missing package was optional fsevents, consistent with omitted optional installation. Version agreement is not forensic proof of all prior process execution or byte-level installed-file integrity. |
| Dependency auto-merge disabled in source | PASS | Workflow has workflow_dispatch only, permissions:{}, and one fixed message; no merge operation or action invocation. Independent dependency regression confirms inert workflow. |
| Public repository setting disables auto-merge | PASS | Read-only GitHub API returned full_name=wiggdevin/design-extract-hardened, visibility=public, default_branch=hardened, allow_auto_merge=false. |
| Dependency and export regressions remain green | PASS | `node --test tests/dependency-security.test.js website/lib/rate-limit.test.js tests/export-security.test.js`: 16 pass, 0 fail, 0 skipped, exit 0. Includes all seven dependency checks and production quota fail-closed test. |
| Local two-stage quota counts requests independently | PASS | Route calls both limiters with extract:ip; corrected development fallback prefixes local-quota:. Regression allows two complete two-stage checks then denies the third in both counters. Production denial branch is unchanged. |
| Local homepage responds | PASS | Read-only HTTP GET http://localhost:3210/ returned 200. No extraction endpoint was called; no quota consumed. Homepage status alone does not certify extraction or rendered UI behavior. |

No installation was run by this reviewer. Current installed package versions agree with the reviewed baseline; the claim that no untrusted install occurred during the earlier publication sequence depends on the implementer's execution evidence, not solely this static/version comparison. The prior Docker runtime block remains unresolved and is not converted to a pass by this publication check.

VERDICT: PASS for restored dependency baseline, disabled auto-merge controls, quota regression and homepage reachability. Extraction, container runtime and earlier execution history remain outside this bounded proof.
