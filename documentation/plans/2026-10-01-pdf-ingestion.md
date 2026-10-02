# Complete, recoverable PDF ingestion

Owner-approved direction, 2026-10-01: process PDFs containing native text,
text inside images, and visual pictures/charts/diagrams. Each image reaches the
existing AI provider separately in an organized workflow. The owner delegated
recommended implementation choices, including Sharp image encoding, durable
per-image receipts and the existing Temporal worker. No new service or framework.
This extends the file hardening scope; it does not launch the company pilot.

## Extraction and model contract

Archive exact original bytes before any AI request. Stream ordered text/image
records from every PDF page; handle XObjects, inline images, masks, alpha and
repeated placements. Encode decoded pixels as valid PNG with Sharp. There is no
arbitrary ten-image document cutoff. Per-operation pixel/byte/time limits fail
visibly and recoverably; never quietly discard content or mark a partial index
complete. Document parser memory limits and cleanup; an encoded-byte cap alone
is not a measured decoded-memory limit.

Parser version: `pdf-v3`. Image analysis prompt version: `document-image-v2`.
Provider: existing Meta adapter; model is the existing configured OCR model or
Meta default. Freeze selection at job creation; stable instructions precede
volatile image content. Model/key availability remains an explicit dependency.

Image analysis returns Markdown with visible text and factual visual description:
transcribe visible labels/text/table values, describe observed chart/diagram
relationships or photographs, flag unreadable/ambiguous material, and never invent
values or treat image instructions as authority. Model descriptions are labeled
AI-derived and uncertain; confidence is not a calibrated measurement. Preserve
exact provider response and reported usage in access-controlled archive/receipts.

## Durable job and attempt contract

Use additive file-owned DB state under the existing DB layer. Job identity binds
sector/scope, original SHA256(base64), parser version, frozen provider/model and
prompt version. Document ID/version stays stable during processing; a separate
extraction digest proves the final output. Existing indexed files/history remain
unchanged. No agent may approve uncertain paid retries or file-context inclusion.

The manifest is a versioned archived JSON object containing an ordered `records`
array: text `{kind:'text',page,text}` or image `{kind:'image',page,ordinal,imageId,
imageHash,inputRef,width,height}`. It contains no credentials. PNG input references
use SHA256(bytes); original archive hashes retain the existing base64 convention.
Workflow history carries job IDs and bounded cursors/counts, never full PDF/image
bytes, response bodies or growing receipt arrays.

Jobs persist queued/processing/paused/failed/uncertain/complete state, revision,
source/model binding, manifest reference, expected/completed/failed/uncertain image
counts and coded errors. Images persist stable page/ordinal/input identity and
current attempt. Immutable attempt rows retain lease/producer identity, provider
start/deadline, pending exact response/usage, result archive/hash, output units and
coded outcome. Each claim is fenced; finished attempts replay their result.

A paid response is staged durably before archive finalization; archive/DB ack
recovery reuses that exact response. A request with no durable response proof is
uncertain and parks: timeout/crash is never permission to repeat a paid request.
Owner retry names job/revision and explicitly approves possible duplicate paid
work when uncertain. Old attempts remain retained. File visibility/scope are
rechecked at each new image dispatch and final publication. Hidden files cannot
resume or publish while hidden; revealing retains completed work.

Run on existing Temporal worker/queues with bounded active OCR calls, sequential
images within each file, bounded activity attempts/deadlines and restart-safe
checkpoints. Provider rounds use the fixed job model/prompt. Reconcile admission
failures and uncertain starts; do not leave phantom indefinitely-processing files.

Prefer provider token counting before each image request. When the optional counter
explicitly reports unsupported access (404/405/501 or 402 `billing_not_configured`),
use the shared full-request estimate with an additional pixel-based image allowance
and record its basis as `estimated`. Preserve the verified model-window/output
reserve and input cap. Other counter failures, invalid counts and oversized inputs
park before dispatch; an unavailable counter never authorizes a denied generation.

Publish all ordered units atomically only after the complete manifest succeeds.
Native text and AI-derived image units retain page/image provenance and the existing
2,000-character unit cap. Original bytes and completed image results remain stored
on failure. Large documents use indexed units on demand; never inject the entire
file into an agent request or silently truncate a valid document's contents.

## API and UI

The sector library exposes processing state/counts and coded recoverable failures.
Upload returns the retained file/job promptly instead of holding HTTP open for all
AI calls. Owner retry is an approver-only UI action with exact revision and duplicate
paid-work acknowledgement when required. No public API accepts archive keys or
self-declared worker authority. OpenAPI/client validation change together.

Show uploading, queued, processing, hidden/paused, failed/uncertain, and indexed
states honestly. Preview/download original bytes remain available to the owner.
Processing/progress/retry controls are part of Files; completed content shows the
organized native text and image analysis with provenance. Context promotion still
requires exact-version owner approval. No automatic scope or permission changes.

## Acceptance

Real mixed/native/scanned PDFs prove actual parser and valid encoded pixel bytes.
Deterministic providers prove every ordered image and text record, more than ten
images, textless visual descriptions, retries, cancellation, worker death, hidden
visibility, missing/corrupt archives, uncertain paid outcomes and final atomic index.
Live Meta/UI proof remains distinct from deterministic fixtures. Measure decoded
memory and queue/provider concurrency; publish limits without claiming perfection
for arbitrary invalid or resource-exhausting files. Preserve all test/pilot data.

## Rendering and operating limits

The owner delegated recommended dependencies within this ingestion scope. Sharp
encodes embedded images; unpdf's recommended native canvas adjunct renders a
page overview when non-text vector painting/shading could otherwise disappear.
Native text and every embedded image remain separate; the page overview provides
visual context for vector-only charts and diagrams. Pure text pages need no
additional AI image round. Source role is retained as embedded or page-visual.

Current parser bounds:8MiB original,8,000,000 pixels and8MiB encoded PNG per
image,30-second parser/encode operation deadlines. Exceeding a bound fails the
job recoverably; it never silently drops an image or publishes partial units.
PDFJS can decode page objects before the pixel check; these limits are not a
process-isolation/RSS guarantee. Scoped decoded-memory measurements and the
repeatable command now live in [the preflight review](../../docs/deep-checks/preflight-authority-review.md):
real near-limit rasters, 1/10/100 repeated placements and two concurrent parsers,
with every image validated and completion/cancellation cleanup checked. These
measurements do not certify distinct-object decompression bombs, sustained fleet
memory or hostile-PDF isolation; those remain full-release operating-envelope gaps.

## Delivery decision

The owner authorized autonomous completion and merge of verified preflight fixes
without another approval request, and deferred the2,000-company campaign to the
following day. This changes the preflight merge timing; it does not turn pending
pilot/full release scenarios into verified capability. Applicable PR checklist
checks, migration rollback, current-source integration/browser proof and independent
verification remain required before merge.
