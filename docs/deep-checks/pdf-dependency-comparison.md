# PDF extraction dependency evaluation

Owner delegated the recommended PDF implementation on2026-10-01, after approving
complete mixed text/image processing and resumable per-image receipts. Candidate
packages were evaluated locally before committing adoption; this record identifies
the exact upstream source before merge. No new service/framework was introduced.

| Package | Version/source commit | License | Applied pattern |
|---|---|---|---|
| Sharp |0.35.5 / `51a990faa26ade5586a4934ac9673c98d8893326` |Apache-2.0 |Bounded raw-raster conversion, alpha/mask handling, actual PNG encoding and native encode deadline |
| @napi-rs/canvas |0.1.100 / `db337893b9b53483050ca7b24c6d306e4da06741` |MIT |unpdf's optional canvas import for rendering vector-only page visuals |

Source identity/license comes from published npm metadata (`npm view <exact-version>
gitHead license repository --json`), retained in ignored
backend/test-results/pdf-{sharp,canvas}-upstream.json. Primary repositories:
[Sharp](https://github.com/lovell/sharp/tree/51a990faa26ade5586a4934ac9673c98d8893326),
[canvas](https://github.com/Brooooooklyn/canvas/tree/db337893b9b53483050ca7b24c6d306e4da06741).
The browser source-fetch tool could not open these exact commit URLs; installed
package/API/license content and registry metadata were inspected instead.

Rejected alternatives: labeling raw PDFJS pixels as PNG is invalid; the old
unpdf image helper also omits inline images/masks. A custom PNG encoder would
reinvent a maintained codec. Sharp alone does not render PDF vector paths;
ignoring those paths loses chart/diagram information. A new browser/service
or renderer framework was unnecessary because unpdf already supplies the
renderer adapter seam. This retains the existing parser, Node runtime, provider,
worker and archive architecture.

Measured benefit is functional correctness, not an unmeasured speed claim:
real mixed-PDF tests failed when native text suppressed image processing and
raw pixels were sent as PNG. Pixel oracles now establish correct ordinary,
inline, masked, alpha, repeated and transformed images; a real green vector
chart was previously absent and is now present in a rendered page overview.
The parser slice passed30 maintained cases. Optimized operator doubles are
labeled separately from actual PDF-byte tests. All encoded inputs remain subject
to8Mpixels/8MiB PNG and30-second operation limits; decoded process memory is a
separate measured gate, not implied by encoded-byte caps.
