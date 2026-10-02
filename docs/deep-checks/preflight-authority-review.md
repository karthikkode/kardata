# Independent preflight authority and file review

Reviewer catalogue_audit. The companion `preflight-authority-review.json` proposes
whole-file manual review entries for ten fully read smaller modules, with exact
source/test hashes. It does not mutate the shared catalogue or acceptance matrix,
and cannot mark any scenario/tier verified. Verify unchanged bytes before applying
review entries. Larger workspace/MCP/archive modules remain outside whole-file
completion by this reviewer; their relevant call sites were inspected only.

## Highest-risk concrete finding and correction

File OCR returned raw transport/provider exception messages in persistent extraction
details. A maintained injected failure reproduced exposure of a synthetic token,
endpoint and body. Image/scanned-PDF transcripts also bypassed the2,000-character
unit cap. Four new maintained cases failed on original code, then passed after the
minimal pipeline correction. A first PDF-double attempt failed because ESM exports
cannot be spied directly; the maintained mock was repaired before observing its
actual product unit-cap failure. No test timeout or oracle was weakened.

Changed runtime: `backend/src/db/file-pipeline.ts`; maintained regressions:
`tests/backend/file-pipeline.test.ts`; design contract: `documentation/db.md`.
Safe failure reasons retain coded transport/HTTP/timeout/shape distinctions and a
safe HTTP status, while generic backend/provider exceptions lose raw text. OCR
boundaries now emit coded start/done/error. OCR chunks keep reading order, OCR
kind/confidence/uncertainty and sequential ordinals. The ten-image scanned-PDF cap
counts attempted images independently of chunk count, including failed attempts.
The PDF transport/parser and OCR are injected doubles, not real document/provider
proof. Existing provider OCR tests still pass unchanged.

Watched final targeted run: file-pipeline.test.ts + ocr.test.ts,16 passed,zero
skips,exit0 onNode22.23.3. Backend lint and typecheck passed. Earlier bounded unit
battery file-pipeline/archive.targets/sector-context/mcp.tools:67 passed,5 gated
skips; that earlier number precedes this OCR fix and is not a final-head broad
verification result. Database/browser/Temporal/retrieval flags were unset.
Integrated final-head gates remain root-owned and were not run by this reviewer.

## Concrete functionality mapping

| Small module | Boundary reviewed in its entirety | Maintained contract scenarios |
|---|---|---|
| context-files | Server-derived read scope/version/unit lineage; exact hidden/hash/index checks; first-child inheritance snapshot; legacy unknown lineage parks; rebuilt history and outbox floors | mcp.file-promotion-provenance: read then derive without fileRef, hidden global/summary, selected unit, child inheritance, changed hash, explicit owner rebuild, unresolved source-dependent mutation, generated exposure and target import |
| execution-records | Session namespace validation, exact lease/run lock, canonical epoch/workflow lineage, immutable event deduplication; scoped keyset metadata/body references, logical-turn recovery lookup | execution-records + execution.inspection: stale lease, forged/foreign attribution, retained lineage, body/key omission,22 records paged without skips, invalid cursor, corrupt/foreign content |
| operation-receipts | Intent/result identity includes owner key/operation/thread/fingerprint/tool; durable exact result recovery, minimal scoped inspection, legacy pending effect remains unresolved | mcp.operation-receipts: failed completion after actual mutation, changed args/authority, foreign thread, absent proof, replaced guard and completion CAS |
| work-review | Scoped paused/failed sector, exact latest approved plan and digest, locked unresolved discovery intake, no active lease/unresolved start; retained before/owner/reason, excluded and retry preserve counters | work.review: keyed authority, immutable exclusion, exact idempotency, contradictory decisions, live child/unknown start, stale and settled receipts |
| owner execution routes | Registered approver required even in open mode; validated bounded cursors; projector catch-up; scoped immutable reference; archive abort on disconnect, corruption distinct from server failure | execution.inspection: real keyed HTTP/isolated DB/filesystem; no provider claim |
| workspace routes | Role-gated registered resources; catch-up before reads/writes, mutation replay, exact version/body schemas; browser proposals lack autonomous authority; approver owner rebuild/review | api.workspace, work.review, mcp.file-promotion-provenance |
| auth keys/execution | SHA256 credential lookup; tenant/project headers only narrow; role ladder; fixed-length timing-safe execution HMAC | api.auth; mcp.tools; mcp.authority invalid/partial binding |
| context adapter | File provenance asserted before agent assembly; visible transcript immutable; parked continuation preferred for compaction; exact checkpoint/version commit; model budget and registry schemas retained | context.compaction-recovery, api.session-compact, mcp.file-promotion-provenance |
| file-pipeline | Content sniffing, size/type/empty/corrupt outcomes, text/DOCX/PDF extraction, bounded per-unit text and OCR metadata, safe coded OCR failures and image-attempt budget | file-pipeline + ocr; final targeted16-case unit result above |

All listed tests exist and were inspected/mapped, but the isolated DB suites were
not run here. A catalogue manual-reviewed file is not an integration assertion.

## Exact outstanding acceptance tiers

The current `acceptance.json` still labels these functionality scenarios pending.
The mappings above identify runnable proof candidates, not proof promotion:

- FILES.library.3 requires integration/browser/live-provider hide-reveal during
  active research. Static visibility checks and synthetic browser fixtures do not
  establish the live-provider safe-round behavior.
- FILES.library.4 requires contract/integration/browser promotion/import; the
  maintained provenance suite supplies an isolated integration oracle only once
  watched on unchanged sources, with exact artifacts.
- MCP.capabilities.2 requires unit/integration forged binding, grant reduction,
  hidden files and child-parent isolation. Whole transport execution remains a
  separate actual HTTP proof; source review cannot satisfy it.
- HTTP.mutation-recovery.3/.4 require the response-loss integration/browser/owner
  review combination. Persisted receipts establish exact confirmed results;
  uncertain or legacy absence stays parked and is not inferred successful.
- CONTEXT.compaction.2/.3/.4 require failures, restart and racing owner repair with
  integration/browser evidence. The smaller adapter review does not certify the
  full Temporal workflow/callback path.
- UI.workspace.2 requires drawer boundaries in addition to390/1440 themes/motion;
  the new focused fixture specs do not alone pin768/1280 boundary transitions.
- Real Meta campaign,2000 accepted genuine companies,deterministic50 validation,
  full stress/overload, archive rollback and final immutable tested-commit evidence
  remain separate root-owned gates. No pilot, rollout or merge occurred here.

## Independent OCR resource-bound follow-up

Root review identified that chunking did not bound aggregate OCR response/text.
Ten further maintained cases failed before the follow-up: streamed oversize body,
NaN/Infinity/out-of-range injected confidence, malformed HTTP confidence and
aggregate scanned-PDF overflow. Malformed confidence previously serialized as null
while uncertainty could be false; it is now rejected before hashing/publication.

No reusable exported bounded JSON reader existed. Public retrieval's reader and
archive deadline helpers are private to their specific operations. A local OCR
reader follows that existing streamed-byte/deadline pattern without a new service
or dependency. It rejects above8MiB before JSON parsing, cancels rejected/late/hung
bodies and includes headers/body within the30-second default deadline. All adapters
validate finite confidence from0 to1 and cap per-transcript UTF8 bytes. Scanned-PDF
aggregate OCR text caps at8MiB and publishes no partial units on overflow. Original
file-byte archiving remains on the existing unchanged ingestion path.

Final focused tests:29 passed,zero skipped; backend lint and typecheck passed;
diff whitespace clean. Additional cases pin hung-body cancellation, late response
cleanup for an abort-ignoring injected fetch, and absent-confidence default1.
These are injected transport/PDF/provider units, not a deployed endpoint or genuine
OCR-document measurement. One operation retains several bounded representations
(chunks/buffer/decoded JSON/units), so8MiB is an input/response limit, not an8MiB RSS
claim.100 concurrent files, parser peak memory and overall overload policy remain
explicit measured-stress gaps. No broad source/test gate or live-provider tier was
promoted. The proposal refreshes only the re-reviewed pipeline and its test hashes.

## Independent scanned-PDF coverage correction

Root independently found the first unit-cap test still accepted ten successful
images from a twelve-image document. That test oracle missed incomplete coverage.
Four maintained regressions then failed on the implementation:12-image budget
truncation,one success followed by OCR failure,a later page extraction error and
a nonempty later page after ten successful images. Each now returns Needs OCR,
a safe reason and no partial units; the attempt budget remains at most ten.
The chunk-order success oracle now uses exactly ten images and asserts complete
image order,confidence and all20 bounded units. Empty image/page coverage is also
explicitly rejected. Final targeted run35 passed,zero skips; backend lint/typecheck
and diff checks passed. The native-text path remains text-layer-only; mixed
native/image completeness is documented as an outstanding gap. HTTP missing
confidence default1 is historical source-inferred behavior,not measured confidence.
The reviewer proposal updates only the re-reviewed pipeline/test hashes again.

## Superseding owner PDF requirement — work remains in progress

The owner now explicitly requires every PDF page's native text and each embedded
image to be processed sequentially through the configured AI provider. The former
scanned-only/budget-stop outcome does not fulfill that request. DB design authority
now states the approved target; source-phase implementation remains unfinished.

Maintained real PDF fixtures in pdf-mixed.test.ts exercise actual production unpdf
parsing for ordinary XObject, inline, image-mask,12 repeated placements and soft-alpha
images, plus zero-image native pages. OCR uses the deterministic provider adapter,
not a live provider. Watched result:five fixture/operator cases plus the native-only
case pass; the required mixed two-page native/image flow fails because current
pipeline performszero provider calls. Its desired oracle asserts distinct valid PNGs,
native/image/native reading order on each page and bounded units. No completion or
verified acceptance claim follows from the six passing setup cases.

Actual parser findings:unpdf.extractImages returns decoded raw pixel arrays,not PNG.
Its helper ignores inline/mask image operators. Real XObject fixtures decode RGB;
inline and soft-alpha fixtures decode RGBA. A mask operator'sdata field is a PDFJS
object identity; resolving it yieldspacked1-bit data with Decode already applied.
The twelve-placement fixture emits twelve ordinary image operators on this parser;
optimized repeat/group operators need separate coverage before all-types acceptance.

Durability gaps were escalated before choosing architecture:new OCR image receipts
need file/version/page/image/provider-model/attempt identity and exact result/archive
proof. Existing execution records require a turn lease and cannot simply certify
upload work. Existing documentstatus is indexed/needs-ocr; public reads normalize
other values,so processing/failure/retry requires an approved contract extension.
The existing upload path archives original bytes after extraction; resumable paid
image work needs archive-before-provider/retry wiring. Owner approval for Sharp,
receipt state and existing-worker/UI integration is pending. No dependency/schema/
workflow/status change was made by this reviewer while that approval is pending.
Verbatim-text-only model OCR cannot certify diagrams/tables' meaning; semantic
extraction needs an explicit approved contract,not an inferred prompt change.

## Approved mixed-PDF parser slice

Owner approval now covers Sharp, file-owned durable receipts and the existing
worker. Design authority:documentation/plans/2026-10-01-pdf-ingestion.md.
This reviewer implemented parser/encoding and maintained fixtures only; root owns
provider semantic prompts, durable jobs/receipts, service activation and UI.

`backend/src/db/pdf-extraction.ts` exports streaming planPdfExtraction(bytes,
{signal?}). It yields page-ordered native-text records and individual PNG-image
records with page ordinal, pixel dimensions and content hash. Geometric reading
order interleaves surrounding native text and honors translated Form XObjects.
Ordinary,inline,packed-bit mask,soft-alpha and repeated image placements have
actual PDF/parser/decoded-pixel tests. Optimized repeat/mask-repeat/mask-group and
inline-atlas paths have PDFJS operator doubles plus actual Sharp pixel checks;
these doubles do not claim the parser optimized those real fixtures.

Owner-approved Sharp0.35.5 was added to backend/package.json and package-lock.json.
Its raw-input channel and PNG output APIs were checked against primary docs:
https://sharp.pixelplumbing.com/api-constructor/ and
https://sharp.pixelplumbing.com/api-output/ . No custom PNG encoder/dependency
substitute or new service was created.

Limits:original8MiB upload,per-image8,000,000 pixels and8,388,608 PNG bytes,30s
per operation and Sharp native encoding deadline. No image-count/total extracted
text cutoff. PNGs encode one at a time; current page text/operator descriptors are
retained. PDFJS can allocate decoded rasters before pixel checks; Sharp can buffer
an encoded chunk internally before its streaming byte check. These are supported
operation limits,not process isolation or100-concurrent memory capacity evidence.
Proxy cleanup runs on exhaustion,early close,cancel and late acquisition; late
abort-ignoring acquisition and translated-form ordering defects were independently
identified,observed failing in maintained tests,and fixed. Early close logs a
closed outcome rather than complete parse success. Coded failures propagate.

Watched final parser suite:23 passed,zero skips onNode22.23.3. Own parser/test/helper
eslint and diff whitespace passed. An earlier backend typecheck passed; the latest
shared typecheck failed on evolving root-owned file-jobs unused chunkTextUnits and
assertRevision declarations, with no errors reported in the parser/test/helper.
A shared lint attempt likewise failed on a root-owned file-jobs unused import;
these shared failures were reported rather than attributed to this slice.
These gates do not prove durable file jobs,provider retries,live Meta,worker restart
or UI activation. The full owner PDF task remains in progress under the root.

Reviewed parser-slice byte identities at 2026-10-01T17:16:51.578752+00:00:

| Path | SHA256 |
|---|---|
| `backend/src/db/pdf-extraction.ts` | `c14143425bc817ae602d84105b51dc290064a1b929877a3b3eb6f499c91d1c19` |
| `backend/package.json` | `b8fee3e5357a8c96cf3a3fec28e9302c898f928b658dae7b226815592e1d4757` |
| `package-lock.json` | `4a470f0707f626a765464c76a3c98a382269513e64ed233936b9e83295a40867` |
| `tests/backend/pdf-fixtures.ts` | `69f95f8fb364f2906362b6287776291a7dd28d25fce0646233cce87b3ce3be09` |
| `tests/backend/pdf-mixed.test.ts` | `5bb681ce31f16545782ea3d640632edeac492e176740fb7237a137ecfee03ec1` |

## Terminal provider metadata and vector-page rendering follow-up

Root's approved PDF contract requires complete provider output; a nonempty string
is insufficient. `ProviderResponse.completion` and stream done metadata now carry
optional complete/incomplete only from explicit Chat finish reasons or terminal
Responses status. Unknown/absent/in-progress status omits the field. Original text,
calls and usage remain present. Checkpoint JSON and resumed recording preserve the
field; no turn behavior or additional paid request was introduced. Fake fixtures
explicitly finish by default and can script incomplete or unknown metadata.
Backend's FakeStep input validation preserves that fixture seam. Eleven maintained
terminal-metadata cases failed before implementation. Three serialized checkpoint
completion cases assert one provider call across archive failure and resume.

Watched hermetic agents gate:254 passed across31 files with probe.test.ts explicitly
excluded; agents lint,typecheck and build passed. A previous ordinary full agents
run auto-loaded local provider configuration and included two live probes; it was
reported to root and is not described as hermetic or a PDF/Meta campaign. Backend
Karbot activity unit30 passed with live flags unset. Latest backend typecheck and
owned-source ESLint passed; diff whitespace clean.

Owner-approved renderer adjunct @napi-rs/canvas0.1.100 now supports the existing
unpdf.renderPageAsImage canvasImport API. Pages with nontext vector painting,
including optimized constructPath fill/stroke actions and shading, emit one
supplemental full-page PNG after ordered page contents. Its role page-visual
records why it exists; individual pictures retain role embedded. Both use stable
ordinals,hashes and bounds. Renderer operation logs carry reason vector-graphics;
no body text or credentials. Pure native-text pages still produce no image/provider
request. Actual native/vector TEST fixtures first demonstrated missing visual
content; the regression now checks the green chart raster at its expected position
within1224x1584 pixels at2x resolution. Full-page actual pixel cases additionally
cover soft alpha,repeated placements and clipping alongside their individual image
records. A real colored-mask fixture separately caught CSS-hex fill state becoming
black; that failure was observed and corrected.

Final parser/renderer gate:30 passed,zero skips. Resource/cancellation optimized
operator doubles remain explicitly separate from actual PDF/decoded-pixel cases.
No arbitrary total document/image cutoff applies. Pixel/output/time limits and
PDFJS/native-buffer memory limitations remain as documented above. Dependency
integrity comparison against HEAD:42 added native/transitive/platform lock entries,
no existing package version changes and no removals. No service/schema/workflow/
OCR-semantic-prompt changes were made by this reviewer in this follow-up. Root owns
durable provider receipts,file publication,activation,UI and final integrated gates.
This remains a source-slice handoff,not completion of the owner PDF task or pilot.

Byte identities at 2026-10-01T17:30:37.765306+00:00:

| Path | SHA256 |
|---|---|
| `agents/src/providers.ts` | `f0eeee75431ea2d5e3b14998f4374451af9b529d78561c7e7bb53be7da3e3f58` |
| `agents/src/transport.ts` | `56430053e312ff66fbf621bc2bfb732fc9521d27525d5e6406b83cf7fc8cc626` |
| `agents/src/responses.ts` | `cd41993cf7d16c31c9159f00d6e56cca08deedecdbd98007058b390b22ebea31` |
| `agents/src/fake.ts` | `588da0f338cb393621f5e31dc4f8d823dabad31ed49e2bb872ed0fb27ba4787e` |
| `agents/src/turnRunner.ts` | `f2e484594904dc9d3845a04c320f185eff358d6c8576a3cf276db7ac3c125b9e` |
| `agents/src/adapters.test.ts` | `76cb4165a99e024157b8a1056dfd6a6c735b2b203f7b43e749fb1317ebb9f102` |
| `agents/src/fake.test.ts` | `9293cecd3c683d9619fa21f1657a4d4af317080b5c197555d6ee6984cf810619` |
| `agents/src/turnRunner.test.ts` | `1f7cb65a5c7af4bede9cd95291b0652019637d0de6898b61e97361f94f621d9f` |
| `backend/src/temporal/activities/turn.ts` | `6e5ec851131680193d65c7b75ab4704e46f8ab4a74ebc63c148bcd109525f52d` |
| `tests/backend/karbot.turn.test.ts` | `8d161404a6ae478dc20a274b12c78e6f4a872f5973d32f5606598281330753e6` |
| `backend/src/db/pdf-extraction.ts` | `c11f8c6326c6ca16d4057ce16c999cb10fc269b360b1cef7be16d8dc4926a555` |
| `tests/backend/pdf-fixtures.ts` | `ef2ccddd85e3667a9ab4c41e0699ed1743000e2a0dd6872d08d10c3965d204ff` |
| `tests/backend/pdf-mixed.test.ts` | `458bed23b616f02e028cb98523d811aad0c8717855cfd5e64bf5784200f415fe` |
| `backend/package.json` | `8846cd055c03417606a11a73effe7f9abece0a912d7a621e070d72d8778f2887` |
| `package-lock.json` | `d0291dd97af3c61321bc64310a6b397d4efb535d0d636f3ce78ab2180c564457` |
| `documentation/agents-providers.md` | `561acfe47652479a113ce04675299325b9dffb425af1e6b0d6848fb843947963` |

## Unicode chunk boundary and invalid budget correction

Runtime/independent review reproduced valid emoji text failing actual file-image
JSONB publication:old2,000-code-unit slicing split surrogate pairs. Independent
before log:backend/test-results/file-jobs-unicode-before.log (ignored integration
output; this reviewer did not claim its live run). This reviewer watched a maintained
1999-unit prefix/emoji boundary case fail,then fixed hard cuts to move before a
paired supplementary codepoint while preserving the existingUTF16 length<=2000.
Four neighboring boundary positions preserve exact joined content and valid scalar
pairs. Normal paragraph packing is unchanged. A one-code-unit budget remains valid
for ASCII but cannot fit a two-code-unit supplementary character and fails explicitly.

Budgets now reject nonpositive/noninteger/nonfinite/>2000 values before iteration.
The maintained invalid-budget oracle executes the actual chunker declarations in
an owned64MiB/2-second child,following the existing HTML extraction resource-test
pattern. Before fixing,zero budget exhausted that owned child's memory; after
fixing it returns six DbContractError codes without looping. No shared process was
killed or shared resource changed. DBdocument-units adds legitimate isolated
sector-ingest/readback Unicode coverage over the actual JSONB path. That suite's
prior ordinarydescribe silently passed no-op cases without DBconfiguration; its
suite gate now explicitly skips unavailable integration instead.

Watched local unit gate:38 passed,5 declared DB skips. Own helper/test ESLint and
diff checks passed. Latest shared typecheck failed only on evolving root-owned
file-processing unused verified declaration; no helper/test type error reported.
The DB regression was not run by this reviewer (heavy slot stays root-owned),and
is not described as live proof. Root/runtime own the DB authority/status updates
and independent live-after gate. Source hashes at 2026-10-01T17:48:26.671381+00:00:

| Path | SHA256 |
|---|---|
| `backend/src/db/file-pipeline.ts` | `6a85c76239d368e81f7bad69914d64aefc91033aec6eb999be6cd09480119561` |
| `tests/backend/file-pipeline.test.ts` | `e3151bfd0a19c8fffe0dc59d03dc22553d364f7222a3ed2dc34814fc2fb3e4ae` |
| `tests/backend/db.document-units.test.ts` | `def6c69900fe0bf734f2ab74a3568338fbe767e52766679ee90896a00bfe2ec4` |

## Shared HTTP/MCP full-PDF admission closure

`db.attach_sector_document` previously called legacy ingest directly,allowing the
native-text early return to bypass durable full-PDF jobs. Two maintained missing
runner/archive cases were watched fail against that previous binding; current
source was restored exactly after the focused before comparison. The shared
backend/file-ingestion semantic operation now handles HTTP and MCP admission.
PDF detection includes decoded magic,so a markdown filename cannot bypass it.
Trusted runner/archive,input size and filename preconditions are checked before
file effects. Missing capability is retry-safe,not a queued/indexed success.
Legacy text/image path remains separate inside the same helper.

Tool context carries only the existing gateway's file-processing capability.
Validated executionThread supplies source provenance; caller sourceThread/owner
arguments cannot supply it or gain research/context/paid-retry approval. Runtime
owns the DB scope/sector validation and immutable per-job/thread source event.
The semantic binding table and maintained parity test identify the single helper;
no tool was added. OpenAPI201 metadata now declares optional processing progress
and503 pre-effect dependency unavailability. Real metadata is refreshed after
admission,so dispatch-failed/fast-completed state is not its initial stale snapshot.
An RPC start exception is dispatch_outcome_unknown and requires owner paid-risk
acknowledgement; a maintained case failed with the earlier safe classification,
then passed after correction. The dispatch boundary logs a coded triple and
retained failure is visible in returned progress. No provider executes inline.

Watched final light battery:90 passed,4 declared gates skipped. Helper/transport
unit13 pass includes role/grant/bound-sector denial,spoofed source identity,actual
Fastify/MCP dispatch over DB doubles,decoded-size preflight,current-state output
and stable concurrent job/revision admission. Own ESLint,backend typecheck and
whitespace checks passed. The existing no-SQL heuristic initially matched an
English select in a new comment; the comment was reworded without changing its
assertion or runtime semantics. Source DB/worker ownership remains root/runtime.

Watched isolated actual keyed HTTP/MCP+Postgres+filesystem gate:
`mcp.file-ingestion-db.test.ts`,4 passed,zero skips,exit0,Node22.23.3,2.27s.
The helper created a UUID-isolated test database from the owner-designated local
TESTPG port32772 and retained its archive/test data. It asserts exact original
bytes,current queued metadata and one coalesced file/job across HTTP/child-MCP;
actual source event uses the validated child,not a forged caller name. Foreign
scope/viewer/bound-child other-sector calls fail without publication; missing
runner/invalid bytes leave job inventory unchanged. Six concurrent uploads
coalesce into one document/job with stable revision. Its runner records admission
only,so this is not Temporal/provider/Meta research evidence. Temporal/Compose/
browser/retrieval/Meta/live-journey flags were unset. The heavy slot was released
immediately to root after completion. Final browser/full-DB/release gates and
owner-deferred2000-company campaign remain separate; no catalogue approval or
merge was performed by this reviewer.

Owned/shared interface byte identities at 2026-10-01T18:36:34.792078+00:00:

| Path | SHA256 |
|---|---|
| `backend/src/file-ingestion.ts` | `6694654a5bd0076c45bd886d277d741c3fca7566f530328137c393f8c3762e79` |
| `backend/src/mcp/tools.ts` | `7f0c234b0fc2bfd4671279bf129e023eb828d49ac0888325ab81ea31c434bd80` |
| `backend/src/mcp/routes.ts` | `8d85e3aa887433b61a17f73f8956c5936df56de0991ee4c480fb2f0944629f89` |
| `backend/src/mcp/schemas.ts` | `2bf96439b9dc65edb4c29c1ae88b35f9bc815abf4accee8f571f04fb6b7d4720` |
| `backend/src/routes/sectors.ts` | `3b8b218649aafede2a411a82e74f64e9582e73ba88bdc07c60d713e78c1e64b6` |
| `backend/openapi/v1.yaml` | `7be031ca1f35c176b32a33c982962934f427890488ec2cddd7465630a53a5c02` |
| `tests/backend/mcp.file-ingestion.test.ts` | `ec2749bbf5ecfee48b87288f06e31cebaeb499e655662c10d1cbe332b3c80725` |
| `tests/backend/mcp.file-ingestion-db.test.ts` | `99d3825bd4d526c1b2943a022a355639a428ac9b08b45c42ef83db4ea089b51c` |
| `tests/backend/mcp.tools.test.ts` | `9296361ff2575f5fb398b9e6c07e9205450179b28e7501b7e6c5146362ea34a3` |
| `documentation/mcp.md` | `1f3bbdc67fb922bc858ea88a4e989a9d747329a2f129b1a1dbb34cc55c28a414` |
| `documentation/backend.md` | `99cd8814bcf75424d0d096fac7af7b6fa948af80f80a589ec34b279ae4256ab1` |
| `documentation/db.md` | `10c5fa8b6a7f364bd8914e68689bcb4caba785faf27bc6154b74058a30c2c62d` |
| `documentation/tests.md` | `b3ec0be2195796a0973b68a98d83b336937322365ce40488806cfc25fbf5f59f` |

## Narrow counter availability and Meta Responses wire closure

Seven maintained cases failed before correction. Typed unavailability applies only
to count404/405/501 or exact bounded402 billing_not_configured. Shared whole-request
measurement preserves caps,uses labeled estimates only for that type,and keeps
generic/auth/malformed errors recoverably parked. Each pre/post-summary reading
records its real method. Meta Responses normal/stream requests clamp tool choice
to auto while retaining tools[] for image analysis. No key/model/scope substitution.
Final hermetic agents278 passed across31 files,probe excluded;lint/typecheck/build
and diff checks passed. Root owns file-activity/pixel estimate and actual Node/UI
proof; this slice makes no live counting/billing or release acceptance claim.

| Path | SHA256 |
|---|---|
| `agents/src/providers.ts` | `dda7721d8eef384090210f641f974b9f7fcbea5c3bd09610c724a03978c25d9f` |
| `agents/src/responses.ts` | `1e9aacd4d541732a89282b080b1ebcc448cc4e3101c384f119016605cb16bd02` |
| `agents/src/compaction.ts` | `e673695d0576c2ffa76690a905f8ef0ce617469aab75760cfc50525a5de84423` |
| `agents/src/meta.ts` | `c8367c61102b0925eea9358e56d0d860a2d29308b2187be06879f76b17af6fb4` |
| `agents/src/adapters.test.ts` | `82e06f447028925d33caa8343c1cca6a368667756670a55f6486f280fc13301f` |
| `agents/src/compaction.test.ts` | `92fcf666f3ea3c4a03a5ab65502033d2402dd4a9829d535db5be84882979c443` |

## 2026-10-02 decoded PDF memory operating measurement

Production `planPdfExtraction` consumed maintained real Flate-compressed PDFs
from `stressImagePdf`:one 3000×2666 RGB image (7,998,000 pixels), placed1/10/100
times, with one/two concurrent iterators. Originals were24,057/24,337/27,128
bytes, below8MiB. No provider, archive, HTTP, database or pilot work ran.
Reproduce with Node22: `KARDATA_PDF_MEMORY_TEST=1 npm test -w @kardata/backend -- pdf-mixed.test.ts -t 'real decoded-memory operating envelope'`.
The opt-in stress case has a120-second harness bound; existing test/product
deadlines remain unchanged.

Measured Linux x64, Node22.23.3, AMD Ryzen7 7840HS,16 logical CPUs,
98,794,881,024 bytes host RAM. Sequential scenarios share one Vitest process;
10ms samples include runtime/allocator retention and may miss short transients.
`external`/`arrayBuffers` measure Node-tracked native allocations, not every
Sharp/PDFJS native buffer. Process-lifetime OS maxRSS and before/after-cleanup
measurements are retained in ignored `backend/test-results/pdf-decoded-memory.json`.

| Placements/job | Jobs | ms | Sampled RSS MiB | Heap used MiB | External MiB | ArrayBuffers MiB |
|---|---|---|---|---|---|---|
| 1 | 1 | 189 | 226.8 | 43.5 | 74.2 | 70.6 |
| 1 | 2 | 114 | 306.9 | 38.8 | 141.6 | 135.1 |
| 10 | 1 | 253 | 332.3 | 39.8 | 96.1 | 92.2 |
| 10 | 2 | 361 | 502.3 | 35.8 | 257.4 | 230.0 |
| 100 | 1 | 1844 | 456.7 | 35.0 | 188.4 | 184.3 |
| 100 | 2 | 1919 | 508.1 | 36.1 | 257.5 | 230.2 |

Each iterator produced exactly1/10/100 images, with consecutive ordinals,
correct dimensions, valid decoded RGB `[17,34,51]`, and identical PNG SHA256
`e0de8a2d95a0b3f57ab1de8b5f523c5ce1ae28fe683a641942ababf2814bca2f`.
Each completed page cleaned once and each document proxy destroyed once.
Cancellation after the first image of a100-placement PDF rejected the next
step and destroyed the proxy once; the explicit page cleanup is not reached
on cancellation, so cancellation proof is proxy destruction.

Full parser suite with stress enabled passed31/31 in6.31s; that process
previously exercised oversized/random raster fixtures and sampled up to807.8MiB
RSS, recorded separately in `pdf-decoded-memory.full-suite.json` and
`pdf-decoded-memory.log`. Focused stress passed1/1 in5.82s (30 filtered tests);
its final100×2 workload took1.919s. Cleanup does not imply immediate RSS
reclamation. These are tested operating measurements, not a hard process
memory guarantee, worst-case PDF proof, sustained worker leak soak, or evidence
for100 distinct simultaneously decoded image objects. PDFJS can decode before
the pixel check; hostile/different-object memory isolation remains unproven.

Measured source/fixture hashes:

| Path | SHA256 |
|---|---|
| `backend/src/db/pdf-extraction.ts` | `c11f8c6326c6ca16d4057ce16c999cb10fc269b360b1cef7be16d8dc4926a555` |
| `tests/backend/pdf-fixtures.ts` | `dab7aef29bdf8b191cf632b0288e2f158c1ac0917e3fa5d447af25e24ea100de` |
| `tests/backend/pdf-mixed.test.ts` | `2ed0823de81cd4b60a49cf9f0b90ed551cba5fd016bb287285fe90942e839e19` |


## Complete PR change scope map

This lists every changed path against the pinned main base. Purpose mapping is not
a claim that the unfinished full-repository catalogue audit is complete. Named
module contracts, maintained regressions and scoped independent verdicts provide
the verification evidence above. Generated evidence is explicitly excluded from
owned runtime behavior.

| Path | Change purpose |
|---|---|
| `.github/workflows/ci.yml` | Permanent lint/type/test/build, isolated integration, browser and PDF memory/SDK gates. |
| `.gitignore` | Approved preflight integration scope: .gitignore. |
| `README.md` | Repository map, owner vision link and shared verification conventions. |
| `agents/src/adapters.test.ts` | Agent execution/provider/context contract implementation or its maintained regression: adapters.test. |
| `agents/src/compaction.test.ts` | Agent execution/provider/context contract implementation or its maintained regression: compaction.test. |
| `agents/src/compaction.ts` | Agent execution/provider/context contract implementation or its maintained regression: compaction. |
| `agents/src/fake.test.ts` | Agent execution/provider/context contract implementation or its maintained regression: fake.test. |
| `agents/src/fake.ts` | Agent execution/provider/context contract implementation or its maintained regression: fake. |
| `agents/src/meta.ts` | Agent execution/provider/context contract implementation or its maintained regression: meta. |
| `agents/src/providers.ts` | Agent execution/provider/context contract implementation or its maintained regression: providers. |
| `agents/src/responses.ts` | Agent execution/provider/context contract implementation or its maintained regression: responses. |
| `agents/src/transport.ts` | Agent execution/provider/context contract implementation or its maintained regression: transport. |
| `agents/src/turnRunner.test.ts` | Agent execution/provider/context contract implementation or its maintained regression: turnRunner.test. |
| `agents/src/turnRunner.ts` | Agent execution/provider/context contract implementation or its maintained regression: turnRunner. |
| `backend/openapi/v1.yaml` | Backend API, ingestion, archive, logging or contract boundary: v1. |
| `backend/package.json` | Existing scripts and owner-delegated Sharp/native-canvas dependency pins and integrity. |
| `backend/src/app.ts` | Backend API, ingestion, archive, logging or contract boundary: app. |
| `backend/src/archive/targets.ts` | Backend API, ingestion, archive, logging or contract boundary: targets. |
| `backend/src/artifacts/pipeline.ts` | Backend API, ingestion, archive, logging or contract boundary: pipeline. |
| `backend/src/browserPool/facade.ts` | Backend API, ingestion, archive, logging or contract boundary: facade. |
| `backend/src/context.ts` | Backend API, ingestion, archive, logging or contract boundary: context. |
| `backend/src/contract.ts` | Backend API, ingestion, archive, logging or contract boundary: contract. |
| `backend/src/db/alerts.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: alerts. |
| `backend/src/db/checkpoints.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: checkpoints. |
| `backend/src/db/company-ledger.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: company-ledger. |
| `backend/src/db/context-files.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: context-files. |
| `backend/src/db/document-units.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: document-units. |
| `backend/src/db/errors.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: errors. |
| `backend/src/db/events.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: events. |
| `backend/src/db/execution-epochs.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: execution-epochs. |
| `backend/src/db/execution-records.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: execution-records. |
| `backend/src/db/file-jobs.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: file-jobs. |
| `backend/src/db/file-pipeline.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: file-pipeline. |
| `backend/src/db/heartbeats.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: heartbeats. |
| `backend/src/db/index.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: index. |
| `backend/src/db/keys.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: keys. |
| `backend/src/db/migrate.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: migrate. |
| `backend/src/db/operation-receipts.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: operation-receipts. |
| `backend/src/db/outbox.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: outbox. |
| `backend/src/db/pdf-extraction.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: pdf-extraction. |
| `backend/src/db/quotas.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: quotas. |
| `backend/src/db/reconciliation.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: reconciliation. |
| `backend/src/db/research-health.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: research-health. |
| `backend/src/db/sector-context.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: sector-context. |
| `backend/src/db/sector-documents.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: sector-documents. |
| `backend/src/db/sector-lifecycle.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: sector-lifecycle. |
| `backend/src/db/sector-plan.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: sector-plan. |
| `backend/src/db/sector-start.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: sector-start. |
| `backend/src/db/sectors.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: sectors. |
| `backend/src/db/threads.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: threads. |
| `backend/src/db/work-review.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: work-review. |
| `backend/src/db/workspace.ts` | Established DB-layer persistence, scope, indexing or recovery boundary: workspace. |
| `backend/src/file-ingestion.ts` | Backend API, ingestion, archive, logging or contract boundary: file-ingestion. |
| `backend/src/mcp/routes.ts` | Validated semantic-tool authority, capability, scope and protocol boundary: routes. |
| `backend/src/mcp/schemas.ts` | Validated semantic-tool authority, capability, scope and protocol boundary: schemas. |
| `backend/src/mcp/tools.ts` | Validated semantic-tool authority, capability, scope and protocol boundary: tools. |
| `backend/src/observability/logging.ts` | Backend API, ingestion, archive, logging or contract boundary: logging. |
| `backend/src/observability/reconciliation.ts` | Backend API, ingestion, archive, logging or contract boundary: reconciliation. |
| `backend/src/observability/requestLog.ts` | Backend API, ingestion, archive, logging or contract boundary: requestLog. |
| `backend/src/observability/trace.ts` | Backend API, ingestion, archive, logging or contract boundary: trace. |
| `backend/src/observability/tracing.ts` | Backend API, ingestion, archive, logging or contract boundary: tracing. |
| `backend/src/ocr.ts` | Backend API, ingestion, archive, logging or contract boundary: ocr. |
| `backend/src/retrieval/browser.ts` | Backend API, ingestion, archive, logging or contract boundary: browser. |
| `backend/src/retrieval/html.ts` | Backend API, ingestion, archive, logging or contract boundary: html. |
| `backend/src/retrieval/keyless.ts` | Backend API, ingestion, archive, logging or contract boundary: keyless. |
| `backend/src/retrieval/proxy.ts` | Backend API, ingestion, archive, logging or contract boundary: proxy. |
| `backend/src/retrieval/web.ts` | Backend API, ingestion, archive, logging or contract boundary: web. |
| `backend/src/routes/alerts.ts` | Backend API, ingestion, archive, logging or contract boundary: alerts. |
| `backend/src/routes/artifacts.ts` | Backend API, ingestion, archive, logging or contract boundary: artifacts. |
| `backend/src/routes/execution-records.ts` | Backend API, ingestion, archive, logging or contract boundary: execution-records. |
| `backend/src/routes/http.ts` | Backend API, ingestion, archive, logging or contract boundary: http. |
| `backend/src/routes/sectors.ts` | Backend API, ingestion, archive, logging or contract boundary: sectors. |
| `backend/src/routes/sessions.ts` | Backend API, ingestion, archive, logging or contract boundary: sessions. |
| `backend/src/routes/threads.ts` | Backend API, ingestion, archive, logging or contract boundary: threads. |
| `backend/src/routes/workspace.ts` | Backend API, ingestion, archive, logging or contract boundary: workspace. |
| `backend/src/streams/outbox.ts` | Backend API, ingestion, archive, logging or contract boundary: outbox. |
| `backend/src/temporal/activities/coordinator.ts` | Existing durable workflow/activity/gateway execution and recovery: coordinator. |
| `backend/src/temporal/activities/execution-epochs.ts` | Existing durable workflow/activity/gateway execution and recovery: execution-epochs. |
| `backend/src/temporal/activities/file-admission.ts` | Existing durable workflow/activity/gateway execution and recovery: file-admission. |
| `backend/src/temporal/activities/file-processing.ts` | Existing durable workflow/activity/gateway execution and recovery: file-processing. |
| `backend/src/temporal/activities/plan.ts` | Existing durable workflow/activity/gateway execution and recovery: plan. |
| `backend/src/temporal/activities/reconciliation.ts` | Existing durable workflow/activity/gateway execution and recovery: reconciliation. |
| `backend/src/temporal/activities/stalls.ts` | Existing durable workflow/activity/gateway execution and recovery: stalls. |
| `backend/src/temporal/activities/sweep.ts` | Existing durable workflow/activity/gateway execution and recovery: sweep. |
| `backend/src/temporal/activities/tools.ts` | Existing durable workflow/activity/gateway execution and recovery: tools. |
| `backend/src/temporal/activities/turn.ts` | Existing durable workflow/activity/gateway execution and recovery: turn. |
| `backend/src/temporal/dev-worker.ts` | Existing durable workflow/activity/gateway execution and recovery: dev-worker. |
| `backend/src/temporal/discovery-acceptance.ts` | Existing durable workflow/activity/gateway execution and recovery: discovery-acceptance. |
| `backend/src/temporal/discovery-intake.ts` | Existing durable workflow/activity/gateway execution and recovery: discovery-intake. |
| `backend/src/temporal/gateway.ts` | Existing durable workflow/activity/gateway execution and recovery: gateway. |
| `backend/src/temporal/reconciliation-start.ts` | Existing durable workflow/activity/gateway execution and recovery: reconciliation-start. |
| `backend/src/temporal/research-plan.ts` | Existing durable workflow/activity/gateway execution and recovery: research-plan. |
| `backend/src/temporal/sweep-rules.ts` | Existing durable workflow/activity/gateway execution and recovery: sweep-rules. |
| `backend/src/temporal/turn-recovery.ts` | Existing durable workflow/activity/gateway execution and recovery: turn-recovery. |
| `backend/src/temporal/workflows/coordinator.ts` | Existing durable workflow/activity/gateway execution and recovery: coordinator. |
| `backend/src/temporal/workflows/epoch-start.ts` | Existing durable workflow/activity/gateway execution and recovery: epoch-start. |
| `backend/src/temporal/workflows/file-admission.ts` | Existing durable workflow/activity/gateway execution and recovery: file-admission. |
| `backend/src/temporal/workflows/file-processing.ts` | Existing durable workflow/activity/gateway execution and recovery: file-processing. |
| `backend/src/temporal/workflows/plan.ts` | Existing durable workflow/activity/gateway execution and recovery: plan. |
| `backend/src/temporal/workflows/reconciliation.ts` | Existing durable workflow/activity/gateway execution and recovery: reconciliation. |
| `backend/src/temporal/workflows/research-bundle.ts` | Existing durable workflow/activity/gateway execution and recovery: research-bundle. |
| `backend/src/temporal/workflows/resumable-turn.ts` | Existing durable workflow/activity/gateway execution and recovery: resumable-turn. |
| `backend/src/temporal/workflows/run.ts` | Existing durable workflow/activity/gateway execution and recovery: run. |
| `backend/src/temporal/workflows/subagents.ts` | Existing durable workflow/activity/gateway execution and recovery: subagents. |
| `backend/vitest.config.ts` | Backend API, ingestion, archive, logging or contract boundary: vitest.config. |
| `db/migrations/0019_turn_attempt_leases.sql` | Additive durable schema and guarded migration for 0019_turn_attempt_leases. |
| `db/migrations/0020_context_file_dependencies.sql` | Additive durable schema and guarded migration for 0020_context_file_dependencies. |
| `db/migrations/0021_execution_epochs.sql` | Additive durable schema and guarded migration for 0021_execution_epochs. |
| `db/migrations/0022_intake_review.sql` | Additive durable schema and guarded migration for 0022_intake_review. |
| `db/migrations/0023_file_processing.sql` | Additive durable schema and guarded migration for 0023_file_processing. |
| `deployment/compose.yaml` | Existing-service resource, network/archive parity and telemetry configuration. |
| `deployment/prometheus.yaml` | Existing-service resource, network/archive parity and telemetry configuration. |
| `docs/architecture.md` | Operational evidence, resource limits, recovery findings and verification status for architecture. |
| `docs/deep-checks/README.md` | Operational evidence, resource limits, recovery findings and verification status for README. |
| `docs/deep-checks/acceptance.json` | Operational evidence, resource limits, recovery findings and verification status for acceptance. |
| `docs/deep-checks/browser-closure.md` | Operational evidence, resource limits, recovery findings and verification status for browser-closure. |
| `docs/deep-checks/catalogue.json` | Operational evidence, resource limits, recovery findings and verification status for catalogue. |
| `docs/deep-checks/opensource-comparison.md` | Operational evidence, resource limits, recovery findings and verification status for opensource-comparison. |
| `docs/deep-checks/pdf-dependency-comparison.md` | Operational evidence, resource limits, recovery findings and verification status for pdf-dependency-comparison. |
| `docs/deep-checks/preflight-authority-review.json` | Operational evidence, resource limits, recovery findings and verification status for preflight-authority-review. |
| `docs/deep-checks/preflight-authority-review.md` | Operational evidence, resource limits, recovery findings and verification status for preflight-authority-review. |
| `docs/deep-checks/runtime-preflight.md` | Operational evidence, resource limits, recovery findings and verification status for runtime-preflight. |
| `docs/deep-checks/ui-boundary-review.md` | Operational evidence, resource limits, recovery findings and verification status for ui-boundary-review. |
| `docs/environments.md` | Operational evidence, resource limits, recovery findings and verification status for environments. |
| `docs/frontend-verification.md` | Operational evidence, resource limits, recovery findings and verification status for frontend-verification. |
| `docs/implementation-status.md` | Operational evidence, resource limits, recovery findings and verification status for implementation-status. |
| `docs/runbook.md` | Operational evidence, resource limits, recovery findings and verification status for runbook. |
| `documentation/README.md` | Design authority and approved contracts for README. |
| `documentation/agents-context.md` | Design authority and approved contracts for agents-context. |
| `documentation/agents-providers.md` | Design authority and approved contracts for agents-providers. |
| `documentation/agents-research.md` | Design authority and approved contracts for agents-research. |
| `documentation/agents-supervision.md` | Design authority and approved contracts for agents-supervision. |
| `documentation/backend.md` | Design authority and approved contracts for backend. |
| `documentation/db.md` | Design authority and approved contracts for db. |
| `documentation/deployment.md` | Design authority and approved contracts for deployment. |
| `documentation/frontend.md` | Design authority and approved contracts for frontend. |
| `documentation/mcp.md` | Design authority and approved contracts for mcp. |
| `documentation/plans/2026-09-30-repo-hardening.md` | Design authority and approved contracts for 2026-09-30-repo-hardening. |
| `documentation/plans/2026-10-01-final-acceptance.md` | Design authority and approved contracts for 2026-10-01-final-acceptance. |
| `documentation/plans/2026-10-01-pdf-ingestion.md` | Design authority and approved contracts for 2026-10-01-pdf-ingestion. |
| `documentation/sector-workspace.md` | Design authority and approved contracts for sector-workspace. |
| `documentation/tests.md` | Design authority and approved contracts for tests. |
| `documentation/vision.md` | Design authority and approved contracts for vision. |
| `frontend/playwright.config.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: playwright.config. |
| `frontend/src/App.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: App. |
| `frontend/src/components/ChatPanel.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: ChatPanel. |
| `frontend/src/components/ExecutionInspector.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: ExecutionInspector. |
| `frontend/src/components/FileProcessingRetry.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: FileProcessingRetry. |
| `frontend/src/components/FileProcessingStatus.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: FileProcessingStatus. |
| `frontend/src/components/Markdown.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: Markdown. |
| `frontend/src/components/ResearchPlanEditor.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: ResearchPlanEditor. |
| `frontend/src/components/SectorDetailPage.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: SectorDetailPage. |
| `frontend/src/components/SectorFilePreview.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: SectorFilePreview. |
| `frontend/src/components/SectorLanding.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: SectorLanding. |
| `frontend/src/components/SectorWorkspace.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: SectorWorkspace. |
| `frontend/src/components/SupervisionAlertsPanel.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: SupervisionAlertsPanel. |
| `frontend/src/components/workspace-parts.tsx` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: workspace-parts. |
| `frontend/src/data/alerts.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: alerts. |
| `frontend/src/data/research-plan.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: research-plan. |
| `frontend/src/data/research.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: research. |
| `frontend/src/data/sector-workspace.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: sector-workspace. |
| `frontend/src/data/staging-api.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: staging-api. |
| `frontend/src/data/useWorkReview.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: useWorkReview. |
| `frontend/src/data/useWorkspace.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: useWorkspace. |
| `frontend/src/data/workspace-api.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: workspace-api. |
| `frontend/src/lib/download.ts` | Shared UI rendering, scoped resource state, responsive interaction or test configuration: download. |
| `package-lock.json` | Existing scripts and owner-delegated Sharp/native-canvas dependency pins and integrity. |
| `tests/backend/alerts.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for alerts.test. |
| `tests/backend/api.sectors.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for api.sectors.test. |
| `tests/backend/api.workspace.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for api.workspace.test. |
| `tests/backend/archive.container.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for archive.container.test. |
| `tests/backend/archive.storage-config.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for archive.storage-config.test. |
| `tests/backend/archive.targets.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for archive.targets.test. |
| `tests/backend/artifacts.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for artifacts.test. |
| `tests/backend/browser-pool.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for browser-pool.test. |
| `tests/backend/browser.isolation.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for browser.isolation.test. |
| `tests/backend/browser.network.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for browser.network.test. |
| `tests/backend/browser.proxy-auth.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for browser.proxy-auth.test. |
| `tests/backend/browser.proxy.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for browser.proxy.test. |
| `tests/backend/context.compaction-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for context.compaction-recovery.test. |
| `tests/backend/db-helper.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db-helper.test. |
| `tests/backend/db-helper.ts` | Maintained behavior, authority, recovery or visual regression coverage for db-helper. |
| `tests/backend/db-setup.ts` | Maintained behavior, authority, recovery or visual regression coverage for db-setup. |
| `tests/backend/db-template-unit.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db-template-unit.test. |
| `tests/backend/db-template.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db-template.test. |
| `tests/backend/db.artifacts.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.artifacts.test. |
| `tests/backend/db.commit-order.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.commit-order.test. |
| `tests/backend/db.discovery-integrity.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.discovery-integrity.test. |
| `tests/backend/db.document-ingest-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.document-ingest-recovery.test. |
| `tests/backend/db.document-units.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.document-units.test. |
| `tests/backend/db.key-provisioning.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.key-provisioning.test. |
| `tests/backend/db.migrations.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.migrations.test. |
| `tests/backend/db.outbox-disconnect.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.outbox-disconnect.test. |
| `tests/backend/db.outbox-subscription.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.outbox-subscription.test. |
| `tests/backend/db.research-budget.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.research-budget.test. |
| `tests/backend/db.sector-documents-query.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.sector-documents-query.test. |
| `tests/backend/db.sectors.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.sectors.test. |
| `tests/backend/db.thread-directory.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for db.thread-directory.test. |
| `tests/backend/deployment.capacity.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for deployment.capacity.test. |
| `tests/backend/discovery.acceptance.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for discovery.acceptance.test. |
| `tests/backend/discovery.intake.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for discovery.intake.test. |
| `tests/backend/execution-epochs.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for execution-epochs.test. |
| `tests/backend/execution-records.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for execution-records.test. |
| `tests/backend/execution.inspection.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for execution.inspection.test. |
| `tests/backend/file-admission.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for file-admission.test. |
| `tests/backend/file-jobs-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for file-jobs-recovery.test. |
| `tests/backend/file-pipeline.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for file-pipeline.test. |
| `tests/backend/file-processing-api.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for file-processing-api.test. |
| `tests/backend/files.library-order.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for files.library-order.test. |
| `tests/backend/hardening.acceptance.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for hardening.acceptance.test. |
| `tests/backend/hardening.catalog.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for hardening.catalog.test. |
| `tests/backend/heartbeat-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for heartbeat-recovery.test. |
| `tests/backend/http.idempotency-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for http.idempotency-recovery.test. |
| `tests/backend/karbot.turn.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for karbot.turn.test. |
| `tests/backend/logging.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for logging.test. |
| `tests/backend/mcp.authority.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.authority.test. |
| `tests/backend/mcp.file-ingestion-db.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.file-ingestion-db.test. |
| `tests/backend/mcp.file-ingestion.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.file-ingestion.test. |
| `tests/backend/mcp.file-promotion-provenance.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.file-promotion-provenance.test. |
| `tests/backend/mcp.operation-receipts.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.operation-receipts.test. |
| `tests/backend/mcp.operation-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.operation-recovery.test. |
| `tests/backend/mcp.tools.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for mcp.tools.test. |
| `tests/backend/no-hardcoded-staging.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for no-hardcoded-staging.test. |
| `tests/backend/observability.logs.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for observability.logs.test. |
| `tests/backend/observability.reconciliation.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for observability.reconciliation.test. |
| `tests/backend/observability.stall-activity.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for observability.stall-activity.test. |
| `tests/backend/observability.stall.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for observability.stall.test. |
| `tests/backend/observability.traces.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for observability.traces.test. |
| `tests/backend/outbox.snapshot.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for outbox.snapshot.test. |
| `tests/backend/pdf-fixtures.ts` | Maintained behavior, authority, recovery or visual regression coverage for pdf-fixtures. |
| `tests/backend/pdf-mixed.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for pdf-mixed.test. |
| `tests/backend/recovery.palette.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for recovery.palette.test. |
| `tests/backend/research-plan.contract.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for research-plan.contract.test. |
| `tests/backend/research.plan-retention.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for research.plan-retention.test. |
| `tests/backend/research.report-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for research.report-recovery.test. |
| `tests/backend/research.transport-budget.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for research.transport-budget.test. |
| `tests/backend/research.work-authority.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for research.work-authority.test. |
| `tests/backend/retrieval.destinations.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for retrieval.destinations.test. |
| `tests/backend/retrieval.dns.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for retrieval.dns.test. |
| `tests/backend/retrieval.fetch-bounds.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for retrieval.fetch-bounds.test. |
| `tests/backend/retrieval.html.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for retrieval.html.test. |
| `tests/backend/retrieval.search-bounds.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for retrieval.search-bounds.test. |
| `tests/backend/retrieval.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for retrieval.test. |
| `tests/backend/sector-approval.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for sector-approval.test. |
| `tests/backend/soak.harness.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for soak.harness.test. |
| `tests/backend/sweep.rules.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for sweep.rules.test. |
| `tests/backend/sweep.search.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for sweep.search.test. |
| `tests/backend/temporal.baseline-replay.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.baseline-replay.test. |
| `tests/backend/temporal.execution-epochs.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.execution-epochs.test. |
| `tests/backend/temporal.legacy-replay.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.legacy-replay.test. |
| `tests/backend/temporal.native-logging.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.native-logging.test. |
| `tests/backend/temporal.owner-resume.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.owner-resume.test. |
| `tests/backend/temporal.reconciliation.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.reconciliation.test. |
| `tests/backend/temporal.research-transition.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.research-transition.test. |
| `tests/backend/temporal.session-runs.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for temporal.session-runs.test. |
| `tests/backend/temporal/epoch-workflows.ts` | Maintained behavior, authority, recovery or visual regression coverage for epoch-workflows. |
| `tests/backend/turn-recovery-contract.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for turn-recovery-contract.test. |
| `tests/backend/turn.activity-lifecycle.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for turn.activity-lifecycle.test. |
| `tests/backend/turn.paid-response-recovery.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for turn.paid-response-recovery.test. |
| `tests/backend/turn.sources.integration.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for turn.sources.integration.test. |
| `tests/backend/work.review.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for work.review.test. |
| `tests/backend/workflows.coordinator.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.coordinator.test. |
| `tests/backend/workflows.delegate.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.delegate.test. |
| `tests/backend/workflows.file-processing.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.file-processing.test. |
| `tests/backend/workflows.fleet-load.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.fleet-load.test. |
| `tests/backend/workflows.plan.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.plan.test. |
| `tests/backend/workflows.run.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.run.test. |
| `tests/backend/workflows.subagents.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for workflows.subagents.test. |
| `tests/evidence/hardening-2026-10-01/preflight-final-pdf-native-and-meta.png` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/evidence/hardening-2026-10-01/preflight-final-pdf-processing.png` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/evidence/hardening-2026-10-01/preflight-final-real-meta-pdf-video.webm` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/evidence/hardening-2026-10-01/preflight-meta-pdf-receipts.json` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/evidence/hardening-2026-10-01/preflight-pdf-decoded-memory.full-suite.json` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/evidence/hardening-2026-10-01/preflight-pdf-decoded-memory.json` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/evidence/hardening-2026-10-01/preflight-safe-evidence.json` | Sanitized synthetic verification evidence and provenance; no runtime behavior or full-release claim. |
| `tests/frontend-e2e/agent-context-db.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for agent-context-db.spec. |
| `tests/frontend-e2e/alerts.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for alerts.spec. |
| `tests/frontend-e2e/context-recovery.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for context-recovery.spec. |
| `tests/frontend-e2e/execution-inspection.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for execution-inspection.spec. |
| `tests/frontend-e2e/file-processing.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for file-processing.spec. |
| `tests/frontend-e2e/files-db.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for files-db.spec. |
| `tests/frontend-e2e/files-scale.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for files-scale.spec. |
| `tests/frontend-e2e/pdf-meta-preflight.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for pdf-meta-preflight.spec. |
| `tests/frontend-e2e/runtime-preflight.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for runtime-preflight.spec. |
| `tests/frontend-e2e/scale.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for scale.spec. |
| `tests/frontend-e2e/work-review.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for work-review.spec. |
| `tests/frontend-e2e/workspace.spec.ts` | Maintained behavior, authority, recovery or visual regression coverage for workspace.spec. |
| `tests/frontend/alerts-api.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for alerts-api.test. |
| `tests/frontend/chat-staging.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for chat-staging.test. |
| `tests/frontend/company-window.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for company-window.test. |
| `tests/frontend/execution-inspection.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for execution-inspection.test. |
| `tests/frontend/file-processing.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for file-processing.test. |
| `tests/frontend/follow-resume.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for follow-resume.test. |
| `tests/frontend/plan-api.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for plan-api.test. |
| `tests/frontend/research-plan-editor.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for research-plan-editor.test. |
| `tests/frontend/sector-file-preview.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for sector-file-preview.test. |
| `tests/frontend/sector-workspace.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for sector-workspace.test. |
| `tests/frontend/supervision-alerts.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for supervision-alerts.test. |
| `tests/frontend/work-review-api.test.ts` | Maintained behavior, authority, recovery or visual regression coverage for work-review-api.test. |
| `tests/frontend/work-review.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for work-review.test. |
| `tests/frontend/workspace-conversation.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for workspace-conversation.test. |
| `tests/frontend/workspace-files-scale.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for workspace-files-scale.test. |
| `tests/frontend/workspace-session-creation.test.tsx` | Maintained behavior, authority, recovery or visual regression coverage for workspace-session-creation.test. |
