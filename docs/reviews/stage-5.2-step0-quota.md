# Stage 5.2 Step 0 — real quota numbers: findings

Question: does the app's Muse expose live 5h/weekly usage % + resets?

## Answer: YES — via the key-mint endpoint (found in docs, verified live).

`POST https://api.meta.ai/muse-code/key` with the device-code `dca:`
access token (inline in the app auth.json) returns `subs_tier_name`,
`is_subs_active`, and `subs_usage`: 5h `{used_percent,
window_duration_mins, resets_at}` + weekly `{used_percent, resets_at}`.
Discard the minted inference key and payment metadata; never store them.
Caveat (third-party doc): `subs_usage` can be null while the 5h window
is idle. The MSP wire schema also has `SubscriptionUsage*` /
`usage/read`, but the endpoint is simpler.

Dead ends checked first (app Muse 1.4.11): no CLI usage command
(`/usage` is TUI-only and renders nothing headless); session logs and
local state carry spend only; binary strings show no endpoint; no
headers logged locally. The 429 text remains unseen (breaker never
tripped) — first real 429 must still be kept verbatim.

## First live reading (Fri 23 Oct 19:12 IST)

Plan: Muse Code Max Usage, active. 5h: 0% (fresh window, reset Sat
00:07 IST). Weekly: 87%, resets Mon 26 Oct 05:30 IST. The owner's
separately seen "96%" does not match the app reading — most likely the
personal account; confirm if it was the app screen.

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

1. Quota monitor polls the mint endpoint (every few minutes, usage
   fields only) and feeds pools_status + the 85/95% pool targets.
   No more learned-allowance guessing for the live %.
2. Capture full 429 bodies verbatim (error text is truncated today) —
   still the only way to learn units and cached handling.
3. At 95% on either window: halt AI starts per the standing rule,
   running tasks finish, deterministic pool widens, auto-resume at
   the reported reset.
