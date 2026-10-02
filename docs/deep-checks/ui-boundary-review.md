# Independent UI and boundary review slice

This is a manual review record, not release approval or a replacement for the
catalogue/acceptance gates. Reviewer: catalogue_audit; timestamp: 2026-10-01T15:31:03.175050+00:00.
Checkout HEAD: `de2e54c416b126dc054ae657ee9298cd59a8f81b`; working tree contains uncommitted changes. These hashes
identify reviewed bytes, not a claim that HEAD contains those bytes. Any changed
hash invalidates this slice for final acceptance. Shared catalogue.json and
acceptance.json were deliberately not changed during concurrent implementation.

## Reviewed functionality and contracts

| Source surface | Concrete review scope | Contract / maintained verification |
|---|---|---|
| SectorLanding, SectorWorkspace | Intake review on landing progress and research Plan; execution entry in local context; plan approval passes displayed ready global version; child/local context isolation remains driven by active thread | documentation/frontend.md; work-review.spec.ts and execution-inspection.spec.ts (synthetic HTTP); sector-workspace.test.tsx |
| workspace-parts PlanProgress | Exact frozen candidate receipt, explicit owner reason, retry/exclude distinction; stale version/digest, unavailable resource, saving and running-sector decisions disabled; excluded count separate from completed; 50-row search window | documentation/frontend.md Basic intake review; work-review.test.tsx; work-review-api.test.ts; work-review.spec.ts |
| workspace-parts WorkspaceFiles | Initial 50 matching rows, 50-row growth, full loaded-library search, filter reset and refresh preservation; hidden files deny preview/inclusion and permit reveal; readable processing/OCR/failure states | documentation/frontend.md Files contract; workspace-files-scale.test.tsx; files-scale.spec.ts |
| workspace-parts local/global context | Exact dependency hashes/unit previews and approval gate; pending receipt inspection does not release a guard; stored summary survives source block; safe rebuild requires independent replacement, explicit confirmation, original version and renewed confirmation after conflict | documentation/frontend.md; sector-workspace.test.tsx; context-recovery.spec.ts |
| workspace-parts WorkspaceOverlay/ResourceNotice | Native modal, Escape/backdrop close, focus restoration; pinned footer and internal scroll; distinct loading/error/denied/offline with retry | documentation/frontend.md; maintained component and browser cases listed above |
| ExecutionInspector | Metadata page selection, previous/next gating, observed context/plan/local labels, actual identity disclosure, 64k initial display, additional text and complete normalized JSON download; body failure cannot render historical JSON | documentation/frontend.md Owner inspection; execution-inspection.test.tsx and execution-inspection.spec.ts |
| workspace-api | URL-encoded owner review/receipt/thread identities; intake digest/state validation; strict bounded metadata with no archive key, UUID leases and valid dates; body must be JSON object; rebuild submits exact version and independent flag | documentation/backend.md owner routes; execution-inspection.test.tsx; work-review-api.test.ts |
| useWorkReview | Requests live in data hook, explicit failure retains dialog draft through parent result, successful save refreshes progress; backend remains authority for approver, pause, child and digest fences | documentation/frontend.md; work-review API/UI tests and synthetic browser journey |
| useSectorWorkspace/useWorkspaceResource | Thread-bound receipt/inspection resources, keyset navigation resets selection, inspection is hidden when active thread changes; resource identity contains base URL/key/key; obsolete loads cannot update resource, permission failure clears old data | documentation/frontend.md; execution-inspection.spec.ts; sector-workspace/workspace-conversation tests. Review is of changed inspection/recovery slice and resource dependency, not complete chat/send proof. |
| logging.ts | Secret key scrub, numeric token-counter exception, cycle-safe metadata, error identity without message/stack, logOp start/done/error and rethrow; native Core uses hashed message plus bounded safe fields instead of raw failure bodies | documentation/backend.md B0.5; logging.test.ts |
| HTTP/MCP boundary | Route errors retain safe route/trace/code; MCP binding authority checked before replay; semantic fingerprint excludes RPC ID and includes scope/role/thread/grant; exact successful receipt written before completion cache and repaired only on same fingerprint; invokeTool boundary selected for logOp review | documentation/mcp.md; logging.test.ts and mcp.tools.test.ts are hermetic. Full MCP INVOKERS module was not audited by this reviewer. |

## Watched checks

Node22.23.3; local Linux checkout; no database/provider/browser credentials used.

- `npm test -w frontend -- execution-inspection.test.tsx work-review-api.test.ts work-review.test.tsx workspace-files-scale.test.tsx sector-workspace.test.tsx`: 5 files, 48 passed, zero skips; exit0.
- `npm test -w @kardata/backend -- logging.test.ts mcp.tools.test.ts`: 43 passed, 2 explicitly gated skips; exit0. Matching by filename also selected a gated native-logging file. No live Temporal claim follows.

These were watched via tool output, but this report does not supply the structured
artifact/tested-commit proofs required to promote acceptance scenarios to verified.
Frontend lint/typecheck/build and broad backend gates belong to the final root run.
Browser specifications above were read, not run by this reviewer. Their fixtures
cannot prove archive integrity, real HTTP/DB authority, provider recovery or Meta.

## Concrete blocker and remaining evidence

HTTP `requestLog.ts` opens an OTel span on ingress but logs pino access only on
response. A hung request therefore has no ingress/start log, contrary to the
AGENTS HTTP ingress/egress requirement. Sent to observability_recovery for a
minimal maintained regression and fix; this review records current bytes and
does not declare it resolved. Recheck the source hash and watched regression
before accepting that boundary.

Final inspection/review/rebuild journeys still need the canonical acceptance
matrix's required tiers with immutable artifacts and tested source/test hashes.
Synthetic browser specs currently exercise390/1440px, not all768/1280 drawer
boundary states in the final campaign. Source dependency provenance, paid-response
recovery, exact owner route authority and live intake acceptance need their
separate isolated integration proofs. No UI-driven Meta campaign,2000 genuine
companies, deterministic50-company validation, live pilot, merge or deployment
was performed by this reviewer.

## Reviewed byte identities

The source paths above were inspected directly; test paths below were read and
mapped. A hash records identity, not behavior or successful execution.

| Path | SHA256 |
|---|---|
| `frontend/src/components/SectorLanding.tsx` | `0b1674b5a989472ee9062e8bac217a57ac117163c47ce21f275388311d0723fb` |
| `frontend/src/components/SectorWorkspace.tsx` | `878a5332678c81f3373a6bd7ac07565067b74ad76e7773b6331b99acdde6f2db` |
| `frontend/src/components/workspace-parts.tsx` | `5da70697de1f15309cff1a9dfed931d3d1d9e6c9c86d52d257f0a337b8507bb0` |
| `frontend/src/components/ExecutionInspector.tsx` | `50686efecfd4acbf008bb15b91841eb5fd3da5f9de99e820192f6983e9f1bce9` |
| `frontend/src/data/sector-workspace.ts` | `0b0cf6bac40d778b98e28dbe4c070c62cd1d9bd6e4bfdb1cac028f8d902fdac8` |
| `frontend/src/data/workspace-api.ts` | `acff855cdf63bca0d7329e815d80684d79fe0b01fa62078bb1ec1101e7543c9d` |
| `frontend/src/data/useWorkReview.ts` | `5d344dfa4ed3a7141abeb873715a2d7290e8d857301f0ad5e37fe4077f292192` |
| `frontend/src/data/useWorkspace.ts` | `49ed744e11356b740bd5b0a457e4cb904e4f11345eb7f6c95717a09662feacc8` |
| `backend/src/observability/logging.ts` | `399bed54c9c39e8cfaae16672eff74c25361895c0ed594f3ba39d3012697eca9` |
| `backend/src/observability/requestLog.ts` | `67897ebb7eaa5363f3843b53489444dfacb6f94966dc088af8bfd62c64ec5805` |
| `backend/src/observability/trace.ts` | `98efff19fc0448db259ba1dbbeb73130b635798c638d07e6e16690af8b64c8ea` |
| `backend/src/routes/http.ts` | `e8459c30957ab86a86c5943cfb611d6c7caf2eeccfec7f4803df6feec25dacf7` |
| `backend/src/mcp/routes.ts` | `b26a416aceffc88e827d614be6c37cf98de177d3394a95b3a9a2bb7d6c4dda3a` |
| `tests/frontend/execution-inspection.test.tsx` | `a3b92c51f5861b5fd3dc4b1159d4622eb4777a0fa5c1a7f57aa2487808770288` |
| `tests/frontend/work-review-api.test.ts` | `278b03ac84bbb25561b335e54fa27cbc76b884750bec2b81f779e6b6422d3ada` |
| `tests/frontend/work-review.test.tsx` | `0648f33f450bd88bc2fa1d881e57eb67cb19f5cda83c1b63b16a45f2868dcaec` |
| `tests/frontend/workspace-files-scale.test.tsx` | `95fb64e4265ed55e44337f32f5ef318948e8434c91062ad65ab22be3f5a62327` |
| `tests/frontend/sector-workspace.test.tsx` | `b4bf70b9776dcb28ee2d39aeaeba84851f3e5089bd2dc8b58576b3cb16832e60` |
| `tests/backend/logging.test.ts` | `32e78061acc1b58c38592c2b11c0ffbc053f58301643eeeb489e5d64e9ec24cf` |
| `tests/backend/mcp.tools.test.ts` | `d1e679b0b81723e2761ba974a773419f2faeebb5d8726a513861582bafdd6a34` |
| `tests/frontend-e2e/work-review.spec.ts` | `4633af008f693b25968a17b680acaaf60747a81bf480434f4a34b9b95847524c` |
| `tests/frontend-e2e/context-recovery.spec.ts` | `6668776105579dea8a12f3ac0f14105762ec8ca9cd6ac0edf829572a4e1afbae` |
| `tests/frontend-e2e/execution-inspection.spec.ts` | `66f20c62e98f278affaf8148206101376f5bc33c5fdfd1c01afd02eeb68a8192` |
| `tests/frontend-e2e/files-scale.spec.ts` | `90a48576c1db49bc3c6a294c7b573007358fe6ba1d425dd38852ae428349ade5` |
