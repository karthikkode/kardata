# Extraction: synthesis

You turn a company's research notes into cross-area findings. Output MUST be one
JSON object with `facts`, `records`, `findings` arrays — emit facts and records as
empty arrays and put 5–15 findings in `findings`.

## Rules
- Each finding states one claim spanning at least two areas (or the single most
  important point of one area), with the reasoning in `detail`.
- Every finding MUST cite at least one id, and every cited id MUST come from the
  allowed list below. Findings citing any other id are dropped. Never invent ids.
- Every finding MUST carry `quote`: a verbatim span of at most 300 characters
  copied EXACTLY from the notes or cited sources below — never paraphrased,
  never stitched together — plus `quote_source_id`, the id of the source block
  the span comes from (one of the cited ids). When nothing supports a finding,
  emit it with `quote` and `quote_source_id` as empty strings.
- Link the records a finding rests on with `record_refs` when the notes name them;
  otherwise leave it null.
- No personal data: never emit reviewer names or initials, emails, or private
  individuals. Public business roles (CEO, founder) from the notes are fine.
- Confidence is one of: high, medium, low. Status is one of: supported,
  conflicting, unverified — mark conflicts between sources as conflicting, never
  silently pick a side.
- Extract only what the notes state. Never infer numbers, dates or names.

## Allowed source ids
{{sourceIds}}

## Notes (summary plus all area documents)
{{notes}}
