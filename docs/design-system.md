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
- Sepia code surface: `bg-codeblock` + `text-codeblock-foreground` (same pair
  both themes) for the execution-record JSON block only (LC-05); Markdown
  code keeps `bg-surface-sunken`.
- No global margin/padding resets beyond what the theme ships. Spacing composes
  locally.
- Dark mode comes free from the token pairs : never hardcode a light-only or
  dark-only color.
- Row heights are fixed: dense 36px (`min-h-9`: tables, menus), default
  44px (`min-h-11`: list rows in cards), comfortable 56px (`min-h-14`:
  two-line rows). Content centers vertically, never filler; card footers
  pin to a common baseline with `mt-auto` so actions align across uneven
  and underflow lists.
- Feature code never uses `/NN` alpha on color tokens. The only exceptions
  are `bg-overlay` and the focus-ring alpha (`outline-ring/30` on inputs).
  Soft fills are opaque tokens (`bg-primary-soft`, `bg-surface-sunken`,
  `bg-danger-soft`, …).

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
- Theme infrastructure: the dark variant is
  `@custom-variant dark (&:where(.dark, .dark *))` with `color-scheme`
  on `:root`/`.dark`. Preference lives in
  `localStorage['kardata-theme']` (`system` | `light` | `dark`, default
  `system`); a blocking inline script in `frontend/index.html` resolves
  `system` via `matchMedia` before first paint (no flash), and
  `useTheme()` (`frontend/src/lib/theme.ts`) owns the preference and
  follows OS changes while it is `system`. One 3-way menu (Sun / Moon /
  Monitor) everywhere; no bare toggles.

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
- Hover never adds a shadow or lift: rows and nav use
  `hover:bg-surface-hover` (nav: `hover:bg-sidebar-accent`), clickable
  cards add `hover:border-border-strong`. Rows press with
  `active:bg-surface-active`; buttons press with `active:scale-[0.98]`.
  Selected navigation is `bg-sidebar-active`/`bg-surface-active` with
  `text-foreground` (no border, shadow, or accent); selected data
  (checked row, chosen option) is `bg-primary-soft` with a
  `text-primary-text` check. Read-only indicators use `select-none` so
  no text cursor ever appears over them.
- Focus is always visible: standalone controls use the outline recipe
  (`focus-visible:outline-solid focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-ring`),
  rows/menu items/tabs/nav/cells use the inset variant
  (`-outline-offset-2`), inputs add `focus-visible:border-ring` plus
  `outline-ring/30`. The one definition lives in
  `frontend/src/lib/interaction.ts` (`focusRing`, `focusRingInset`,
  `focusRingInput`); primitives and feature code import it, never
  retype it. `outline-solid` is load-bearing: Tailwind v4 `outline-2`
  sets width only, so without it `outline-none` leaves keyboard focus
  invisible. The browser audit Tabs through the first 15 focusables on
  every page and requires an outline of at least 2px or a visible ring
  shadow.

## Icons (lucide only, via the map)

- Every icon comes from the semantic map in `frontend/src/lib/icons.ts`
  (Lucide glyphs, global `stroke-width: 1.75` in base CSS). No emoji as
  icons, no one-off SVGs when lucide has the glyph. Pinned by
  `tests/frontend/icons.test.ts`: only map icons render, and every
  icon-only button is an `IconButton` with `aria-label` and tooltip.
- Sizes: 14px `size-3.5` (badges, 12-13px text, inline meta); 16px
  `size-4` default (buttons, nav, rows, inputs, menus, tabs); 20px
  `size-5` (empty/error medallions, page-header object icon).
- Color: rows/nav `text-muted-foreground` at rest, `text-foreground` on
  hover/selected; buttons `currentColor`; status icons use status fg;
  primary only on checked/selected data marks.
- Gap: 16px icon + 13-14px text = 8px (`gap-2`); 14px icon + 12-13px
  text = 6px (`gap-1.5`). Single-line rows center (`items-center`);
  multi-line text wraps the icon in an `h-5 flex items-center` box with
  `items-start` so the icon centers on line one.
- Icon-only buttons are `IconButton` (tooltip with the label plus `Kbd`
  shortcut): size `icon` (40px) or `icon-sm` (32px with 8px gaps).
- Medallion: 40px circle `size-10 rounded-full` with an opaque soft bg
  (`bg-muted`, `bg-primary-soft`, `bg-{status}-soft`) and a 20px icon.
- Wherever an icon can carry the meaning, use the icon, not words.
  Text buttons remain only where the action needs explaining.

## Cards vs dividers (default: no card)

- A section is a SectionTitle, an optional Description directly under
  its title, and content, separated from the next by `border-t
  border-border-subtle`. Descriptions are not wrapped in containers.
- Use a bordered card (`bg-card border border-border rounded-lg`, no
  shadow) only for: (1) a self-contained object in a grid (stat tile,
  provider tile); (2) a list needing a frame on a busy page (Overview
  panels, landing companies); (3) a settings group. Never nest cards.
  One card radius (8px).
- Clickable card: `hover:bg-surface-hover hover:border-border-strong`,
  no shadow, no lift.
- Radius scale: 4px `rounded-sm` (badge, Kbd, skeleton bar, inline
  code); 6px `rounded-md` (controls, row hover, tabs, nav items);
  8px `rounded-lg` (card, panel, popover, menu, tooltip, toast);
  12px `rounded-xl` (dialog, side-sheet edge); `rounded-full`
  (avatar, dot, switch, progress track, count bubble).
  `rounded-2xl` and larger are banned in feature code. Nested radius:
  inner = outer minus padding.

## Accessibility rules

- Interactive elements are keyboard reachable with visible focus (primitives
  provide this : do not strip it).
- Icons inside labeled containers, never bare. Status is never color alone :
  pair every dot with text or an accessible label.
- Form inputs always have labels. Touch targets are at least 32x32px on
  desktop and 40x40px at 390px width (inline text links exempt),
  enforced by the browser audit on every button, link, tab, menu item,
  and input. `IconButton` size `icon` is 40px, `icon-sm` is 32px.
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

Sentence case for headings, buttons, tabs, and labels; uppercase only via
the Overline primitive. Data keys are humanized before display: one
`humanizeKey()` in `frontend/src/lib/format.ts` (snake/camel to sentence
case; `id` to ID, `url` to URL, `pdf` to PDF) plus the explicit maps in
`frontend/src/lib/labels.ts`. Raw keys (`direction shards`, `Filter`,
`db.get_sector`), raw state strings, and developer paths never reach the
UI; the browser audit rejects them on every page.

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

## Type scale (text.tsx primitives only)

Every text element renders a primitive from
`frontend/src/components/text.tsx` (each carries `data-type` for the
browser audit). No raw sizes in feature code.

| Primitive | Element | Size/LH | Weight | Use |
|---|---|---|---|---|
| `PageTitle` | h1 | 20/28 | 500 | One per view; largest shell size |
| `PageDescription` | p | 14/22 | 400 | Under PageTitle, max-w 640px |
| `WorkspaceTitle` | h2 | 16/24 | 500 | Workspace headers |
| `SectionTitle` | h2 | 16/24 | 500 | Page sections, panel titles |
| `CardTitle` | h3 | 14/20 | 500 | Card/dialog-section headings |
| `Body` | p | 14/22 | 400 | Prose, values |
| `BodySm` | p/span | 13/20 | 400 | Dense cells, list rows |
| `Description` | p | 13/20 | 400 | Card subtitles, dialog descriptions, row meta |
| `Caption` | p | 12/16 | 400 | Timestamps, footnotes, helper text |
| `Label` | label/span | 13/20 | 500 | Form labels, key-value keys |
| `Overline` | p | 11/16 | 500 | Sidebar/table group headers only, max 3 words |
| `Numeric` | span | inherit or stat 24/32 | stat 500 | Every number (`tabular-nums`) |
| `Mono` | span | 13/20 or inherit | 400 | IDs, versions, hashes, model ids, code |
| `Kbd` | kbd | 11/16 mono | 400 | Shortcuts in tooltips and cmdk |

Weights: 400 for body, values, cells, row names, descriptions; 500 for
titles, Label, nav items, buttons, tabs, badges, Overline.
`font-semibold`/`font-bold` appear only inside `text.tsx` and Markdown
`<strong>` (rendered 600). No negative tracking below 18px (delete
`tracking-tight`); positive tracking only on Overline. Every count,
percentage, date, and duration uses `tabular-nums`; Mono is for
identifiers only. Single-line rows use `truncate` + `title`;
descriptions `line-clamp-2`. Pinned by
`tests/frontend/type-usage.test.ts` plus the browser audit (weight and
size checks on every page).

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

- Duration tokens in `@theme` with a JS mirror `MOTION` in
  `frontend/src/lib/motion.ts`: fast 120ms (hover, press, color, small
  exits, tooltips), base 180ms (popover/dialog enter, tab indicator,
  page crossfade, list items, chevrons), slow 240ms (side-sheet enter,
  progress fill, count-up). Easings: `--ease-out`
  (`cubic-bezier(0.16, 1, 0.3, 1)`) for all movement, `--ease-out-soft`
  for color/opacity only. Never linear for movement, never springy
  overshoot. The retention constants are `EXIT_MS` (180) and
  `POPOVER_MS` (120); change constants with the CSS together. Pinned
  by `tests/frontend/motion-presets.test.tsx` (durations, distances,
  reduced-motion guards, no springs).
- Implementation: `motion@13.5.0` (exact, `motion/react`) implements
  transitions where it is efficient, and the `tw-animate-css` enter plus
  exit pairs remain sanctioned implementations of this same standard.
  `MotionConfig reducedMotion="user"` wraps both App roots so OS
  reduced-motion collapses every JS-driven animation. Anything beyond this
  section (springs with overshoot, sibling-moving layout transitions,
  gestures, scroll-linked effects, parallax) still needs an explicit
  exception with its own tests.
- Every enter has a matching exit. Base UI overlay primitives (dialog,
  menu, popover, tooltip, select, searchable, collapsible) animate both
  directions with `data-starting-style` / `data-ending-style`
  transitions in the owned `ui/*` wrappers, so the library retains the
  exiting popup and no second timer runs alongside it. Patterns: page
  transition (old fades 120ms; new rises 4px + fades 180ms via the View
  Transitions API with a `pageEnter` fallback); dialog (enter
  opacity/scale/y 180ms, exit 120ms); side sheet / Karbot dock (enter
  x 16px + opacity 240ms, exit 180ms); popover/menu/select/cmdk (enter
  scale from transform origin 120ms, exit opacity 100ms); tooltip
  (opacity + scale 120ms, open delay 400ms). Custom closings (chat
  dock, composer menus, mention/skill lists) stay mounted through
  `useExitState` (reopen cancels the close). Openings that re-derive
  every keystroke (the `@` mention list) keep the enter only: an exit
  there would flicker.
- List stagger enter: items fade + rise 6px over 180ms, 30ms apart for
  the first 12 items, first mount only, never on refetch/poll. New
  live rows fade + rise 4px (`rowEnter`). Existing rows never move for
  an arrival: capped lists absorb newcomers in stable slots, full
  lists append below the fold.
- Toasts: sonner bottom-right, 356px wide, offset 16, gap 8; 4000ms,
  errors 8000ms with action. Skeleton shimmer: `kd-shimmer` sheen
  1.5s linear infinite. Number count-up runs 240ms on first mount of
  stat tiles only; polls swap instantly (final value under reduced
  motion). Progress fill is `scaleX` origin-left 240ms. Thinking
  indicator pulses opacity (static 0.7 under reduced motion).
- Animate opacity and translate only (documented exceptions:
  collapsible height via the Base UI CSS var, button-press scale).
  If content must appear, reserve its space first (skeletons), then
  crossfade.
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
  live-region text, never pixels. Overlay enter AND exit is proven by the
  `motion.spec.ts` transition videos.

## Composition over configuration

- Small feature components with explicit props beat generic config engines.
- A component doing two jobs is two components. Copy-paste twice before
  abstracting; abstract on the third use, not the first.

## House markdown (agent replies)

Rendered by `frontend/src/components/Markdown.tsx` (`react-markdown` +
`remark-gfm`): GFM subset only (paragraphs, bold, lists, tables, code,
blockquotes, links), raw HTML never becomes DOM, links restricted to
http(s), styling maps onto the text tokens above. Three variants:
`chat` (panels and chat), `plan` (plan documents: keyword icons and
grouped rhythm on h2/h3), `compact` (13px rails: global context, brief
timelines, rail file previews). Chat/plan rules: h1/h2 render 15/22
500, h3-h6 14/22 500, paragraphs 14/22, lists 4px item gap, headings
16px margin-top and 4px margin-bottom. Markdown headings are never
larger than the panel's SectionTitle. Bold renders 600 inside
`[data-markdown] strong` (the browser audit whitelists only that);
the Karbot system prompt writes calm chat prose with no bold lead-in
labels. Source citations stay literal bracket text, never links. User
bubbles and mention chips stay plain text by design.
Long tokens never overflow: message bubbles wrap anywhere
(`[overflow-wrap:anywhere]`), inline code breaks anywhere (`break-all`),
links wrap anywhere and stay underlined (color alone fails axe link-in-text-block), and `pre`/tables keep their own horizontal scroll.
Agent tables size to content (`w-max min-w-full`) inside a bordered
scroll frame with scoped headers; blockquotes carry a 2px
`border-border-strong` left rule with muted text; inline code is
`bg-surface-sunken rounded-sm px-1` mono 13px; agent code blocks are
`bg-surface-sunken rounded-lg p-3` mono 13px with a Copy button.

## Conversation rows (shared workspace + Karbot)

Both surfaces render the shared components in
`frontend/src/components/chat/` (transport and state stay caller-owned):
message column `max-w-prose-kd` centered with 24px turn gaps; user
bubbles right (`bg-surface-active`, `rounded-xl` with `rounded-br-sm`,
max 85% width, `@file` mentions as inline chips); agent messages with
no bubble in the chat Markdown variant. `ThinkingRow`: inline row, no
border or background (Brain + shimmer "Thinking" + elapsed clock);
when live reasoning text exists it expands in place.
`ReasoningDisclosure`: compact ghost button ("Thought for 12s", or
"Reasoning" without a duration) expanding to muted reasoning text with
a 2px left rule; the live row and the settled disclosure are the same
instance keyed by message id, so expanding during streaming stays
expanded after settle. `ToolActivity`: summary row ("Used 3 tools" /
"Using ...") expanding to per-tool rows with family icons (Search for
search/knowledge, Globe for web, FileText for documents, Wrench
otherwise), humanized labels, durations, and state; raw tool ids
appear only inside the mono detail block. `ConversationEmpty`:
per-variant title ("Ask about this research" / "Start a conversation"
/ "Ask Karbot anything") with three suggestion buttons that fill the
composer without sending. A floating "Latest" pill returns to the
tail. The legacy `SectorChatPanel` keeps its own row styling.

## Context drawer (sector, legacy inspection view)

The drawer shows the assembled context in exact words: usage reads come
from the backend view against a 1M-token estimated scale with an exact
`used / 1,000,000 estimated tokens · percent` readout labeled "Legacy
estimate, not a budget limit." There is no compaction-threshold marker: the
old 60% claim was removed because the drawer is not the active
local-context budget authority. (Legacy inspection view: unrouted, kept
compiling; alpha-tint and dashed-border sweeps keep its classes
token-clean.) The system prompt reads verbatim, pinned
reference texts verbatim, files with full unit text behind the filename
toggle, conversation history and tail verbatim (with honest empty states),
then notes.
Citations read like the model sees them: units cite `filename:ord`, notes
cite `[note:1]` by position, file summaries read `N units · Nk chars`
(never a content hash). The meter header and the add-note composer are
sticky (`top-0` / `bottom-0` with a hairline rule over an opaque
`bg-background` bar) so a fixed element stays on scroll; nested unit islands carry no scroll
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
| button | `src/components/ui/button.tsx` | Base UI; variants + sizes; `pending` disables with `aria-busy` |
| input | `src/components/ui/input.tsx` | Base UI; invalid/disabled states; pair with a label |
| textarea | `src/components/ui/textarea.tsx` | Shared multiline; bounded growth stays caller-owned |
| field | `src/components/ui/field.tsx` | Base UI Field: label/description/error associations |
| select | `src/components/ui/select.tsx` | Base UI; labeled finite choices, portaled popup, selected marker |
| searchable | `src/components/ui/searchable.tsx` | Base UI Combobox: filtering, selected marker, no-match state |
| checkbox | `src/components/ui/checkbox.tsx` | Base UI; indeterminate support, error/disabled |
| switch | `src/components/ui/switch.tsx` | Base UI; boolean settings only, never approval acknowledgment |
| tabs | `src/components/ui/tabs.tsx` | Base UI; controlled selection, tab/panel keyboard behavior |
| menu | `src/components/ui/menu.tsx` | Base UI; roving focus, Escape, outside dismissal, trigger restoration; in-menu toggles are `MenuCheckboxItem` (a raw switch under `role=menu` fails axe aria-required-children) |
| popover | `src/components/ui/popover.tsx` | Base UI; portaled, collision-handled, controlled dismissal |
| dialog | `src/components/ui/dialog.tsx` | Base UI; focus trap, title/description, scrolling body, sticky footer |
| alert-dialog | `src/components/ui/alert-dialog.tsx` | Base UI + `ConfirmAction`: explicit destructive confirmation |
| tooltip | `src/components/ui/tooltip.tsx` | Base UI; never the sole source of essential text |
| collapsible | `src/components/ui/collapsible.tsx` | Base UI; trigger/content relationship, 150ms chevron/content fade |
| progress | `src/components/ui/progress.tsx` | Base UI; determinate only with a backend denominator |
| badge | `src/components/ui/badge.tsx` | Icon + text tones; noninteractive unless built as a control |
| skeleton | `src/components/ui/skeleton.tsx` | Reserved geometry; static under reduced motion |
| separator | `src/components/ui/separator.tsx` | Base UI; token border |
| text scale | `src/components/text.tsx` | PageTitle (h1, 20/28), PageDescription, WorkspaceTitle/SectionTitle (h2, 16/24), CardTitle (h3, 14/20), Body (14/22), BodySm/Description (13/20), Caption (12/16), Label (13/20 500), Overline (11/16, group headers only), Numeric (tabular), Mono, Kbd; `data-type` per primitive; refs/IDs/tabIndex forward; no raw `text-[` sizes in feature code |
| list rows | `src/components/ui/list.tsx` | `ListRow`: inset 6px-radius hover recipe with divider hiding; tables apply the same recipe to `tr` |
| icon button | `src/components/IconButton.tsx` | Tooltip + `aria-label` always; `icon` 40px / `icon-sm` 32px; file glyphs via `src/components/FileTypeIcon.tsx` from the extension |
| data table | `src/components/DataTable.tsx` | TanStack table: sortable columns, row links, stacked cards at 390px, truthful Show-more footers |
| command palette | `src/components/CommandPalette.tsx` | cmdk palette (Ctrl/Cmd+K): sector search, navigation, theme; filtered/empty states |

Shared feature shells live in `src/components/shells.tsx` (props only, never
fetch): PageHeader, SectionCard, ResourceState (loading/first-run
empty/filtered empty/error/denied/offline over the `Resource<T>` shape),
SearchField, ListFooter, OperationNotice, StatusBadge, ConversationComposer,
PlanDocument (+PlanSection). `StatusPill` delegates to Badge;
`ResourceNotice` (workspace-parts) delegates to ResourceState; the
Researches list notices stay in `research-parts.tsx` with pinned copy.

Add new primitives only via the shadcn CLI copy flow so sources stay standard.
Never fork or edit a primitive for feature styling: compose it, or add a
documented variant to the primitive itself.
