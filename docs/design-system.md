# Design system

Canonical home for UI rules: tokens, theming, layout, interaction,
icons, containers, accessibility, copy, and house markdown. Component
anatomy and behavior stay in `documentation/frontend.md`. Stack: Vite +
React + TypeScript SPA, Tailwind CSS v4, owned primitives in
`frontend/src/components/ui` (shadcn copy flow over Base UI). Tokens in
`frontend/src/index.css` (`:root` + `.dark`).

## Styling rules

- Tokens only: use theme colors (`bg-background`, `text-muted-foreground`,
  `border-border`, …). No arbitrary hex values, no one-off status colors.
- No global margin/padding resets beyond what the theme ships. Spacing composes
  locally.
- Dark mode comes free from the token pairs : never hardcode a light-only or
  dark-only color.
- Shared surfaces share one row height (`min-h-19` on research rows, content
  centered, never filler); card footers pin to a common baseline with
  `mt-auto` so actions align across uneven and underflow lists.

## Theming : light and dark are both first-class (default rule)

Every component must be designed and verified in both themes. No exceptions,
even for small components.

- Use token pairs only (`bg-background`, `text-foreground`,
  `text-muted-foreground`, `border-border`, …). Each token resolves in `:root`
  and `.dark` : that pairing IS the theme support. A hardcoded color or shadow
  that only works in one theme is a defect.
- Contrast must hold in both themes: text on its background at WCAG AA
  (4.5:1 normal text). If a tone dot or badge is decorative, the adjacent
  label still carries the meaning.
- Shadows and borders behave differently per theme: verify elevation reads on
  dark (raise border contrast, not just shadow blur).
- Verify both before handoff: flip the demo app's theme toggle and eyeball the
  changed surface in each theme; component tests assert token classes, never
  pixel values.
- Review check: hardcoded `white`, `black`, or hex values outside `index.css`
  fail review. A `dark:` variant is allowed only as a paired adjustment next
  to its base token class (the way owned primitives do it) : never as the
  sole theming mechanism, and never with a hardcoded value.
- Animation respects `prefers-reduced-motion` (global guard in `index.css`);
  use `motion-safe:`/`motion-reduce:` for anything beyond transitions.

## Scrollbars : thin, token-matched, everywhere (standard rule)

- One definition in `frontend/src/index.css`, zero per-component colors: the
  global base sets `scrollbar-width: thin` plus `::-webkit-scrollbar` rules
  (10px track, rounded thumb, transparent track and corner), and the
  `scroll-slim` utility refines dense areas (popovers, menus, tables, code)
  to an 8px track with `overscroll-behavior: contain`.
- Idle thumbs use `color-mix(in oklch, var(--muted-foreground) 45%,
  transparent)` with hover/active at full `var(--muted-foreground)` : visible
  on both themes, still token-only, never a hardcoded hex. Dark mode comes
  free from the token pair.
- Every `overflow-y-auto` / `overflow-x-auto` container carries `scroll-slim`
  (chat lists, popovers, mention/skill menus, model flyout, research
  overflow lists, detail columns, `pre` and table wrappers). Nested islands
  that must hand the wheel to their parent (drawer unit lists, the drawer
  content itself) stay containment-free and rely on the global thin base,
  so scroll never traps: a scrollport that traps the wheel fails review.
  A scrollport that never overflows must not claim `overflow` either: a
  non-scrolling `overflow` ancestor traps sticky pins, so the drawer
  content is plain flow and the column scrolls.
- Enforcement: `tests/frontend/scrollbars.test.ts` asserts the engine rules,
  the token fills, and the utility exist; `tests/frontend-e2e/scrollbars.spec.ts`
  forces overflow in researches, chat, tables, code, model menu, detail, and
  dark chat, asserting the hook plus computed thin width before every shot.

## Interaction affordances

- Every clickable element shows `cursor-pointer` on hover : buttons, cards,
  rows, tabs, links rendered as cards. If it reacts to a click, the cursor
  must promise it before the click.
- Non-interactive elements never show a pointer. Status pills, badges, and
  plain text keep the default cursor.
- Disabled controls keep `disabled:pointer-events-none` (no cursor at all)
  rather than a misleading pointer.
- Clickability is structural, never just a CSS class: a clickable element
  renders a `button` (or link), a read-only one renders a `span`/`div`. Review
  check: if it has `cursor-pointer` without keyboard support, it is broken.
- Clickable chips and cards confirm hover with elevation (`hover:shadow-md`)
  plus the pointer. Read-only indicators use `select-none` so no text cursor
  ever appears over them.

## Icons over text, containers over free text

- Wherever an icon can carry the meaning, use the icon, not words. Theme
  toggle, close, search submit, send, expand: icon buttons with accessible
  names. Text buttons remain only where the action needs explaining
  ("Push to email drafts", never "OK").
- Icons come from lucide-react only, sized `size-4` in buttons and rows,
  always `aria-hidden` next to a visible label or `aria-label` when alone.
  No emoji as icons, no one-off SVGs when lucide has the glyph.
- No free-flowing text. Descriptive and helper text always lives inside a
  chip, card, or bordered container. Bare paragraphs drifting on the page
  background are not allowed.
- Exempt as structural: page and section headings, form labels, and text
  inside controls. Everything else sits in a container.
- Why: free text misaligns against UI elements and looks unfinished next to
  contained content. Review check: any bare descriptive paragraph outside a
  container fails review.

## Accessibility rules

- Interactive elements are keyboard reachable with visible focus (primitives
  provide this : do not strip it).
- Icons inside labeled containers, never bare. Status is never color alone :
  pair every dot with text or an accessible label.
- Form inputs always have labels. Touch targets are at least 40px (`icon`
  size-10) where pointer input is expected; dense multi-button rows may use
  32px (`icon-sm`) only with 8px gaps and a written reason.
- Async swaps return focus to a designed target (usually the composer),
  never `body`: approve, deny, retry, steer, send, and anything that unmounts
  the focused control.
- Below `md` the sidebar is an icon rail: labels hide visually but stay as
  accessible names, and the brand mark hides with them.

## Copy rule : no em dashes in frontend strings (hard rule)

No static string in `frontend/src` (placeholder, heading, label, summary,
empty state, button text) may contain an em dash (U+2014). Use a colon,
comma, or period instead. This covers everything our code renders, including
comments-adjacent copy that could leak into the UI.

Exempt: AI responses, agent thinking blocks, and any dynamic content arriving
at runtime. We cannot control those. Everything else is ours and stays clean.

Enforcement: `tests/frontend/no-em-dashes.test.ts` scans every file under
`frontend/src` and fails the suite on the first em dash found. Review check:
if added UI copy shows an em dash character, the change is rejected.

## Typography : one sans, one mono (standard rule)

Research verdict: purpose-built screen typefaces, variable weights, no
brand-font experiments. Exactly two families, both already wired:

- UI and body: Geist Variable (`font-sans`, the default). Headings use the
  same family at larger sizes and weights, never a second sans.
- Code, version numbers, timestamps, metrics: Geist Mono Variable
  (`font-mono`). Metrics that change value use tabular numerals.
- Hierarchy comes from size and weight only: one family at several sizes
  beats several families. Never a single weight and size throughout.
- Fallbacks stay system (`sans-serif` / `ui-monospace`) so text renders
  before fonts load. Fonts load from installed packages only, never a
  runtime CDN link.
- No new font family without owner approval.

Enforcement: `tests/frontend/typography.test.ts` asserts the two token
families exist in `index.css`, that no other font package is imported in
`frontend/src`, and that no `font-family` declaration appears outside
`index.css`. Review check: a third typeface, or a `font-[...]` arbitrary
utility smuggling one in, fails review.

## UX principles : Nielsen heuristics as rules

Source standard: Nielsen Norman Group, 10 Usability Heuristics for Interface
Design. Each heuristic below is rewritten as a rule with a check. A surface
that breaks one is unfinished, however polished it looks.

1. Show system status. Every async action displays its state (loading,
   progress, done) within the surface where it started. Nothing happens
   silently. Check: trigger the action, confirm feedback appears.
2. Speak plain words. Labels match real-world language, never ids, enum
   names, or jargon. Check: read the UI aloud; anything a non-engineer would
   not say fails.
3. Give control and exits. Every started action can be cancelled; every
   destructive action confirms first; every view has a way back. Check: name
   the exit for each new flow.
4. Stay consistent. Same action, same control, same place, every screen.
   Primitives and tokens exist for this. Check: a new pattern that duplicates
   an existing one fails review.
5. Prevent errors before explaining them. Disable invalid choices, constrain
   inputs, validate inline. Error text is the last resort, not the strategy.
6. Prefer recognition over recall. Options stay visible; do not hide meaning
   in tooltips, memory, or hover-only hints.
7. Serve both new and expert users. Common paths stay obvious; repeated
   actions gain keyboard paths. No keyboard traps.
8. Keep it minimal. Every element competes for attention; remove what does
   not serve the current task. Progressive disclosure over crowded screens.
9. Make errors recoverable. Every error states in plain words what happened
   and the exact next step. No dead ends, no codes without translations.
10. Teach in context. Empty states explain what goes there and how to fill
    it. Help appears where the question arises, not on a separate page.

## Transitions : motion with rules

Motion is a state change made visible. Every animation on this project cites
one of these patterns; anything else needs an explicit exception.

- Durations: 150ms for micro feedback (hover, focus, pressed), 200ms for
  enter, exit, and section changes. One easing everywhere: ease-out. Never
  linear for movement, never springy overshoot. The JS constant is `EXIT_MS`
  in `frontend/src/lib/motion.ts`; change it with the CSS together.
- Every enter has a matching exit at the same duration. Closings stay mounted
  through `useExitState` (reopen cancels the close) and swap the shared
  enter/exit class pair; popovers drift with fade plus a small scale change,
  the chat dock slides from the edge. Openings that re-derive every keystroke
  (the `@` mention list) keep the enter only: an exit there would flicker.
- Animate opacity and translate only. Never height, margin, padding, or
  anything that reflows siblings. If content must appear, reserve its space
  first (skeletons), then crossfade.
- List insertions animate the entering row only (fade plus a small rise).
  Existing rows never move for an arrival: capped lists absorb newcomers in
  stable slots, full lists append below the fold.
- Section changes crossfade the content, scroll to top, and move focus to
  the page heading. Announcement rides on the focus move; no extra live
  region for navigation.
- Live data changes (counts, arrivals) announce through a polite live region
  on the changed value, in the same frame as the visual update.
- Reduced motion is already global (`index.css` zeroes all durations): every
  transition must still complete its non-motion work (focus, scroll, content
  swap) when durations collapse to zero. Skeletons keep `motion-safe:` so
  they go static, never invisible.
- Review check: a transition that moves siblings, lacks a focus or scroll
  contract on navigation, or animates without a `motion-safe` story fails
  review. Smoothness is eyeballed on device; tests assert roles, focus, and
  live-region text, never pixels.

## Composition over configuration

- Small feature components with explicit props beat generic config engines.
- A component doing two jobs is two components. Copy-paste twice before
  abstracting; abstract on the third use, not the first.

## House markdown (agent replies)

Rendered by `frontend/src/components/Markdown.tsx` (`react-markdown` +
`remark-gfm`): GFM subset only (paragraphs, bold, lists, tables, code,
blockquotes, links), raw HTML never becomes DOM, links restricted to
http(s), styling maps onto the text tokens above. The system prompt
contracts the output format (bold lead-ins, bullets, tables for counts,
code citations, no raw HTML). Source citations stay literal bracket text,
never links. User bubbles and mention chips stay plain text by design.
Long tokens never overflow: message bubbles wrap anywhere
(`[overflow-wrap:anywhere]`), inline code breaks anywhere (`break-all`),
links wrap anywhere, and `pre`/tables keep their own horizontal scroll.

## Chat rows (sector chat)

Shared shells live in `frontend/src/components/chat-parts.tsx`: a centered
agent mark (initial-letter token avatar plus chat name) with session actions
at the row edges, centered relative-time dividers on gaps past five minutes,
user bubbles right (shrink-wrapped, soft primary tint), agent bubbles left
in muted fill. One quiet activity disclosure per reply: consecutive tool
calls share a grouped summary row ("2 Kb search, Scan") with per-call status
icons (spinning while running, check when done, X when failed) and elapsed
age on running calls; provider reasoning shares the row and starts open only
while live. Thinking never appears as a message bubble: the replying
placeholder mounts only when a turn is live with zero frames. The
research strip controls and single-pill composer keep
their existing behavior; Karbot keeps its own layout and only shares the
overflow-safe markdown.

## Context drawer (sector)

The drawer shows the assembled context in exact words: the meter scaled to
the 1M-token model window with an exact `used / 1,000,000 · percent`
readout, the system prompt verbatim, pinned reference texts verbatim, files
with full unit text behind the filename toggle, conversation history and
tail verbatim (with honest empty states), then notes. Usage numbers come
from the backend view; only the window scale is a display constant.
Citations read like the model sees them: units cite `filename:ord`, notes
cite `[note:1]` by position, file summaries read `N units · Nk chars`
(never a content hash). The meter header and the add-note composer are
sticky (`top-0` / `bottom-0` with a hairline rule and blur backdrop) so a
fixed element stays on scroll; nested unit islands carry no scroll
containment, so the wheel chains to the column instead of trapping. The
drawer content itself is not a scroll container (a non-scrolling
`overflow` ancestor would trap the sticky pins); the column scrolls. The
note composer input keeps a ring offset so its focus ring never overlaps
the Add button. Proven by `tests/frontend-e2e/polish.spec.ts` (pins,
chaining, hover/focus, dark) with shots `polish-drawer-*`.

## Primitives inventory

Owned, editable sources : not a package. Do not replace with a component
library without owner approval.

| Primitive | Source | Notes |
|---|---|---|
| button | `src/components/ui/button.tsx` | `cva` variants; Radix Slot for `asChild` |
| input | `src/components/ui/input.tsx` | Unstyled field; pair with a label |

Add new primitives only via the shadcn CLI copy flow so sources stay standard.
Never fork or edit a primitive for feature styling: compose it, or add a
documented variant to the primitive itself.
