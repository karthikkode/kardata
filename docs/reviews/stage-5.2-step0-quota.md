# Stage 5.2 Step 0 — real quota numbers: findings

Question: does the app's Muse expose live 5h/weekly usage % + resets?

## Answer: no live % anywhere. Only the 429 text, which we have never seen.

Checked 2026-10-23 (app Muse 1.4.11, read-only probes):

1. CLI: `muse --help` lists 17 commands (resume, exec, export, trace,
   model-profile, auth, login, ...). No usage/quota/limits command.
2. Session logs (`goal_usage_attribution` records): spend only —
   input/output/cached/reasoning tokens per call. No quota, limit,
   reset, or percent field in any record type.
3. Local state: `~/.config/muse/` holds only auth.json. No usage files.
4. Binary strings (`muse-bin-1.4.11`): no usage/quota endpoint hints.
5. HTTP layer: provider is remote; no headers are logged locally.
6. 429 text: only a synthetic fixture exists
   (`"Subscription quota exhausted. Your usage window resets at <date>"`).
   No real sample ever captured (breaker never tripped). Unknown whether
   it names the 5h vs weekly window. First real 429 must be kept verbatim.

## Cached tokens: unknown

Nothing local says whether cached input counts toward the caps.
Pay-as-you-go bills cached at a reduced rate (public pricing chatter),
but subscription-quota counting is undocumented. One sampled call was
~36% cached, so the answer moves the meter by up to a third. Only the
first real 429 (comparing metered burn vs trip point) can settle it.

## Estimation fallback (already built) and its error

Learned allowance + window + 95% early trip (`breaker.ts`):

- First sample meters ALL-TIME burn (no window start yet): can read
  wildly high, so early-trip may not protect until the second sample.
- One window tracked; if the first trip is the 5h cap, the weekly cap
  stays unknown. 5.2 needs dual-window tracking.
- If the cap counts prompts/requests instead of tokens (some plan
  chatter says prompts), token metering is meaningless. Unverifiable
  until the first trip.
- Cached-token ambiguity adds up to ~35% error either way.
- In-flight burn estimate (weekly per-ms rate) is rough (±50%).

## Short plan (needs owner go)

1. Capture full 429 bodies verbatim (error text is truncated today).
2. Track 5h and weekly windows separately from the first trip's data.
3. pools_status shows learned % with a "low confidence until N trips"
   flag rather than pretending precision.
4. Revisit after the first real trip; only it calibrates units, cached
   handling, and both windows.
