# State design : every state, every scale

A component or page design is incomplete until each state below is designed,
not just the happy path with three tidy rows. Research consensus (Nielsen
heuristics on status visibility and error recovery; industry practice on
empty, loading, and boundary states): users meet the edge states first
(first run, slow network, crowded data), so those states set their trust.

## The state matrix (mandatory for every data surface)

Design and verify all seven. "Not applicable" needs a written reason, not
silence.

1. Loading. Skeleton structure over spinners: show the shape of what is
   coming, not a void. Content areas reserve space so arrival does not shift
   layout.
2. Empty, first run. A real designed state with explanation plus the action
   that fills it. Never a blank screen, never a disabled-looking void.
3. Empty, filtered. "No matches" copy differs from "nothing exists" copy, and
   offers clearing the filter. A failed fetch must never render as empty:
   check error before the empty branch.
4. Populated, few. One item, two items. Layout holds without collapsing or
   stretching oddly.
5. Populated, many (overflow). The scaling state. Lists virtualize or paginate
   past the agreed threshold (default 50 rows: document the number per
   surface). Long text truncates with full text one interaction away
   (expand, tooltip, or detail view), never clipped silently. Menus and
   popovers never clip inside an overflow ancestor.
6. Error. States what happened in plain words, what to do next, and offers
   retry where retry can work. Partial failure names what succeeded and what
   did not.
7. Denied or unavailable. Permission-denied, offline, session-expired, and
   rate-limited each explain how to proceed (grant, reconnect, wait),
   in context. Denied and offline are staged scenarios with a retry that
   lands on content. Partial failure is not applicable in the mock layer:
   fixtures fail all-or-nothing by design, so when the backend is real its
   contract must name per-item failures where a panel can load half a list.

## Scalability rules

- Design for N+1, not N. If the plan says 100 companies, the component holds
  101 without rework: scrolling strategy, truncation, and counts adapt.
- Counts stay truthful at every scale ("101 companies", never "100+"
  hiding the remainder unless the remainder is one click away).
- Thresholds are documented per surface: at what count the strategy changes
  (paginate, virtualize, summarize), and what the user sees at the changeover.
- Performance is a state: past the threshold, first paint stays fast and
  the loading state covers the rest.
- Thresholds per surface, all owned by the shared `OverflowList` (default 50
  rows): the Researches full list, the sector company list, and the activity
  feed scroll in place past 50 with a truthful total chip. The chat thread is
  unbounded by count and uses stick-to-bottom autoscroll with a back-to-latest
  button when the user scrolls up. Chat popovers (sessions, files, mention)
  and the subagent list use compact scroll regions (`max-h-56`/`max-h-64`).

## Enforcement

New data surfaces name their seven states plus thresholds in the change
description, with a screenshot or test per state where the state is visual.
Review check: any data surface missing a designed empty, error, or overflow
state fails review.

## Landing (Overview) matrix

Three panels load independently, so each names its own seven. Preview any
combination with `?stats=<v>&sectors=<v>&companies=<v>` (mock only, deleted
at backend integration).

Email stats (`stats=`): loaded, loading, empty (zeros plus a hint, used for
both first run and a quiet day), error with retry, denied (locked card, ask
an admin). Filtered: not applicable, stats never filter by search. Overflow:
not applicable, three fixed cards.

Sector researches (`sectors=`): loaded, loading, empty first run (copy-only
card, no button: a creation CTA with no backend would be a dead button),
empty filtered (copy plus a working Clear search button), few (one row),
many (60 rows in a scroll region past the 50-row threshold, truthful "60
total" chip), error with retry, withFailed and withComplete overlays (plain
words "Failed" and "Complete", token tones only). Denied: not applicable,
lists share workspace visibility.

Company researches (`companies=`): same seven as sectors, with stage dots
kept next to every row including overflow rows.

Rows stay non-clickable until a detail route exists. Counts tick up only via
fresh data, never a fixed percentage bar: progress without a fixed end is a
count, not a percent.

Landing shows the newest 5 rows per list; the full list lives on the
Researches page (Sectors and Companies segments, text plus state-chip
filters, Back to Overview) behind View-all buttons that carry the full
count. Arrivals animate the entering row only; a polite live region
announces them. Section changes crossfade, scroll to top, and focus the
heading.

Sector detail page: loading, load error with retry, not-found, populated
(header, filtered company list, activity feed, quiet-activity empty),
first-run company empty, filtered empty with clear, paused and failed
overlays, restarted confirmation, viewer-locked actions, row-level failed
state with restart.

Assistant chat: empty with working suggestions, history loading, history
error with retry, denied lock, sending with typing indicator, streaming
with stop, stopped partial kept, failed delivery with retry, tool
running, done, failed with retry, approval pending, approved with effect,
denied with note. Reduced motion: every stream lands instantly with all
content and controls intact.
