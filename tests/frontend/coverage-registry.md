# UI coverage registry (maintained)

Every handoff ID maps to its source component, route/test host, states,
component tests, browser scenarios, evidence, and review status. Pure
utilities and data/config files map to compatibility tests or a justified
nonvisual classification at the bottom. Evidence PNGs/WebMs live ignored
under `frontend/test-results/` (fresh runs) and curated under
`tests/evidence/hardening-2026-10-01/`; the human verdicts accumulate in
`docs/frontend-verification.md`.

Legend: L/D = light/dark, viewports 390/1440 unless noted, RM = reduced motion.

## Shell (SH) — App.tsx, Sidebar.tsx, TopBar.tsx

| ID | source / route | states | component tests | browser | evidence | status |
|---|---|---|---|---|---|---|
| SH-01 ordinary layout | App.tsx `/` | loading/empty/error/denied/offline per view | Navigation.test.tsx, navigation-url.test.tsx | smoke, visual, matrix L/D 390/1440 + RM | matrix-*, overview-empty.png | pass |
| SH-02 sidebar | Sidebar.tsx | expanded/collapsed/rail | Sidebar.test.tsx | visual wave1, matrix | wave1-sidebar-collapsed.png | pass (tooltips on collapsed items) |
| SH-03 Emails disabled | Sidebar.tsx | coming-soon | Sidebar.test.tsx | visual wave1 | wave1-sidebar-collapsed.png | pass |
| SH-04 TopBar | TopBar.tsx (shells SearchField) | query/clear, chat toggle, theme | TopBar.test.tsx | visual wave1 | wave1-dashboard-filtered.png | pass |
| SH-05 theme | App.tsx dark toggle | light/dark, persisted | TopBar.test.tsx | matrix L/D | matrix-dark-*.png | pass, no page fade |
| SH-06 backend-not-connected | App.tsx staging branch | not-configured | Navigation.test.tsx | smoke (no staging) | overview-empty.png | pass, no fake data |
| SH-07 nav/loading failures | App.tsx + detailData | loading/error/denied per route | navigation-url.test.tsx, SectorDetailPage.test.tsx | workspace, matrix | — | pass |

## Overview (OV) — Dashboard.tsx, research-parts.tsx

| ID | source | states | component tests | browser | evidence | status |
|---|---|---|---|---|---|---|
| OV-01 dashboard | Dashboard.tsx `/` | 2 preview cards | Dashboard.test.tsx | visual, matrix | overview-empty.png | pass |
| OV-02 email placeholder | StatsPanel | unavailable notice | Dashboard.test.tsx | visual | overview-empty.png | pass, no fake zeros |
| OV-03 sectors preview | SectorPanel | loading/empty/filtered/few/many/error/denied/offline | Dashboard.test.tsx | visual, matrix | wave1-dashboard-filtered.png | pass |
| OV-04 companies preview | CompanyPanel | same seven + stages | Dashboard.test.tsx | visual | formatter-*.png | pass |
| OV-05 first run | FirstRun | copy + action | Dashboard.test.tsx | visual | overview-empty.png | pass |
| OV-06 filtered empty | FilteredEmpty | no-match + Clear search | Dashboard.test.tsx | visual | wave1-dashboard-filtered.png | pass |
| OV-07 independent failure | per-panel branches | error inside card | Dashboard.test.tsx | visual | — | pass |
| OV-08 preview footer | View-all + counts | capped preview honesty | Dashboard.test.tsx | scale | — | pass |

## Researches (RS) — ResearchesPage.tsx

| ID | source | states | component tests | browser | evidence | status |
|---|---|---|---|---|---|---|
| RS-01 page | ResearchesPage `/Researches` | tabs/toolbar/list/footer | ResearchesPage.test.tsx, navigation-url.test.tsx | visual, matrix, revamp-evidence (tabs/select/dialog L/D, zoom) | researches-list.png, revamp-researches-dialog-light/dark.png, revamp-zoom-dialog.png | pass (Base UI Tabs, SectionCard, ListFooter) |
| RS-02 filter bar | FilterBar (SearchField + Select) | search/state/clear | ResearchesPage.test.tsx | matrix, revamp-evidence | — | pass |
| RS-03 sector rows | FullList + SectorRow | few/many/overflow | ResearchesPage.test.tsx | scrollbars | scroll-researches.png | pass |
| RS-04 company rows | CompaniesFullList + CompanyRow | server paging 100-row | company-window.test.tsx, ResearchesPage.test.tsx | scale | — | pass |
| RS-05 create dialog | CreateSectorDialog (ui/dialog + Field) | validation/pending/failure-keeps-draft | ResearchesPage.test.tsx | revamp-evidence (open/Escape/focus, L/D, zoom) | revamp-researches-dialog-*.png, revamp-zoom-dialog.png | pass |
| RS-06 SectorRow | research-parts.tsx | nav target + focus | Dashboard.test.tsx | visual | — | pass, no nested buttons |
| RS-07 CompanyRow | research-parts.tsx | read-only metadata | Dashboard.test.tsx | — | — | pass |
| RS-08 StageDots | research-parts.tsx | labeled stages | Dashboard.test.tsx | — | — | pass, text + dots |
| RS-09 overflow/footer | OverflowList | 50-row threshold + truthful counts | OverflowList.test.tsx | scale | — | pass |

## Sector landing (SL) — SectorLanding.tsx

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| SL-01 header (Back + name) | ready/loading/error/denied | sector-workspace.test.tsx, SectorDetailPage.test.tsx | visual, matrix, workspace | pass |
| SL-02 status card | draft/planning/planned/approved/running/paused/queued/failed/complete | sector-workspace.test.tsx | workspace, matrix | pass |
| SL-03 progress dialog | shared PlanProgress | work-review.test.tsx | workspace, work-review.spec | pass |
| SL-04 Open | pending nav, failed init retry | navigation-url.test.tsx | workspace | pass |
| SL-05 companies | status-specific empties + paging | SectorDetailPage.test.tsx | visual wave2 | pass |

## Workspace (WS) — SectorWorkspace.tsx

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| WS-01 100dvh 3-rail layout | rails scroll independently | workspace-session-creation.test.tsx | workspace 1440/390 L/D | pass |
| WS-02 desktop rails | token backgrounds | — (visual) | workspace-1440-*.png | pass |
| WS-03 resources drawer <1280 | single instance | — | workspace boundary 1279/1280 | pass |
| WS-04 sessions drawer <768 | single instance | — | workspace boundary 767/768 | pass |
| WS-05 session toggle | research/chats + arrows | workspace-tabs.test.tsx | workspace | pass |
| WS-06 list/search | 50-row window, truthful footer | workspace-session-creation.test.tsx | workspace | pass |
| WS-07 new conversation | pending + acknowledged publish | workspace-session-creation.test.tsx | — | pass |
| WS-08 header | identity/back/lifecycle/model | — | workspace-*.png | pass |
| WS-09 research tabs | chat/plan + arrows, drafts kept | workspace-tabs.test.tsx, workspace-conversation.test.tsx | workspace plan-approval-* | pass |
| WS-10 ResearchControl | plan/approve/start/pause/resume | SectorChatPanel.test.tsx | plan-full (live-gated skip) | pass |
| WS-11 options/delete | rename + ConfirmAction delete | session-options.test.tsx, nested-overlays.test.tsx | revamp-evidence (open/Escape) | pass |
| WS-12 URL state | session/thread restore, invalid scope | navigation-url.test.tsx, workspace-session-creation.test.tsx | workspace | pass |

## Conversations (CH) — ChatPanel.tsx, chat-parts.tsx, SectorWorkspace.tsx ConversationView

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| CH-01 transcript | centered, sticky composer | chat-staging.test.tsx, workspace-conversation.test.tsx | scrollbars, polish | pass |
| CH-02 external-store adapter | order/grouping/timestamps | assistant-adapter.test.tsx, assistant-runtime.test.tsx | smoke | pass |
| CH-03 ThreadPrimitive iteration | stable keys, no reanimate | chat-staging.test.tsx, follow-resume.test.ts | — | pass |
| CH-04 user bubble | tint/width/wrap + mentions | chat-parts.test.tsx, chat-staging.test.tsx | formatter | pass |
| CH-05 agent bubble | markdown, partial kept | chat-staging.test.tsx, markdown.test.tsx | formatter | pass |
| CH-06 AgentMark | parent/child identity | chat-staging.test.tsx | — | pass |
| CH-07 time divider | 5-min grouping | chat-staging.test.tsx | — | pass |
| CH-08 activity disclosure | count/summary/failed (ui/collapsible contract) | chat-parts.test.tsx | smoke tool test | pass |
| CH-09 tool rows | running/done/failed + ages | chat-staging.test.tsx | smoke | pass |
| CH-10 thinking | active-turn only, clock | chat-staging.test.tsx | — | pass |
| CH-11 turn status | queued/working/reconnect/paused/failed/stopped/done/denied/offline | chat-staging.test.tsx, follow-resume.test.ts | context-recovery | pass |
| CH-12 back to latest | tail reading | workspace-conversation.test.tsx | polish | pass |
| CH-13 composer layout | shells ConversationComposer around both caller-owned composers | shells.test.tsx, chat-staging.test.tsx | polish, matrix | pass (adopted workspace + Karbot; drafts/IME/mentions/steering untouched) |
| CH-14 keyboard | Enter/Shift+Enter, IME, mention keys | chat-staging.test.tsx | — | pass |
| CH-15 steer/stop | separate actions | chat-staging.test.tsx | — | pass |
| CH-16 missed steering | retained card + next-turn path | chat-staging.test.tsx | overflow steering stills | pass |
| CH-17 send/retry failure | draft kept, explicit retry | chat-staging.test.tsx | files-db (retained drafts) | pass |
| CH-18 copy | settled-only Copy button, success + failure states | chat-parts.test.tsx | — | pass (AgentBubble copyText in dock/workspace/legacy; live text excluded) |

## Karbot dock (KB) — ChatPanel.tsx sessions/files/context

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| KB-01 dock | desktop ≤480px / mobile full | chat-staging.test.tsx | transitions, matrix | pass |
| KB-02 header/views | rename/picker/files/context/close | chat-staging.test.tsx | visual chat-model-picker | pass |
| KB-03 sessions popover | selection/new/pinned order | chat-staging.test.tsx | — | pass |
| KB-04 deletion | ConfirmAction, touch-visible 32px target | chat-staging.test.tsx, SectorChatPanel.test.tsx | revamp-evidence (open/Escape) | revamp-deletion-dialog.png | pass |
| KB-05 files menu | indexed refs, no fake upload | FilesMenu.test.tsx | — | pass |
| KB-06 mentions | matching/insert/routing | chat-staging.test.tsx | — | pass |
| KB-07 skills | descriptions/invocation | chat-staging.test.tsx | — | pass |
| KB-08 plan mode | /plan toggle semantics | chat-staging.test.tsx | — | pass |
| KB-09 files view | 32px preview/download, create dialog | chat-staging.test.tsx | file-processing | pass |
| KB-10 preview/download | loading/error/content, visible failures | chat-staging.test.tsx, sector-file-preview.test.tsx | file-processing | pass |
| KB-11 context view | session vs global distinction | chat-staging.test.tsx | agent-context-db (live-gated) | pass |
| KB-12 close/reopen | Esc/button/toggle, reopen cancels exit, sibling topmost-only | Navigation.test.tsx, nested-overlays.test.tsx | transitions | pass |

## Markdown/plan (MD/PL) — Markdown.tsx, ResearchPlanEditor.tsx, SectorPlanSection.tsx, workspace-parts PlanProgress

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| MD-01 GFM contract | paragraphs/headings/lists/quotes/tables/code/links | markdown.test.tsx | formatter L/D 390/1440 | pass |
| MD-02 tables | scroll frame, scoped headers | markdown.test.tsx | formatter, scrollbars | pass |
| MD-03 code | mono surface, bounded scroll | markdown.test.tsx | scroll-chat-table.png | pass |
| MD-04 links/citations | safe URLs, literal brackets | markdown.test.tsx | — | pass |
| MD-05 streaming | no remount, incomplete MD | follow-resume.test.ts | overflow recovery | pass |
| MD-06 plan variant | shells PlanDocument + plan-brief | research-plan-editor.test.tsx | workspace plan tab | pass |
| PL-01 PlanDocument shell | version/status/sections, workspace + landing + (legacy keeps behavior) | shells.test.tsx, sector-workspace.test.tsx | workspace plan-approval-*, revamp timing N/A | pass (adopted workspace Plan tab + landing dialog) |
| PL-02 narrative | heading/value rhythm, unknown sections | research-plan-editor.test.tsx | workspace | pass |
| PL-03 executable details | target/cap/budget/concurrency | research-plan-editor.test.tsx | workspace | pass |
| PL-04 direction cards | timeline rail with medallions, numbered full-text rows | research-plan-editor.test.tsx | workspace, revamp-evidence | revamp-plan-timeline-light/dark.png | pass |
| PL-05 instructions | full brief + disclosure | research-plan-editor.test.tsx | — | pass |
| PL-06 acceptance | neutral decimal list, no status icons | research-plan-editor.test.tsx | — | pass |
| PL-07 target/cap | numeric text only, bar removed | research-plan-editor.test.tsx | — | pass |
| PL-08 version timeline | newest-first inspection | research-plan-editor.test.tsx | workspace | pass |
| PL-09 editor dialog | grouped fields, sticky footer | research-plan-editor.test.tsx | hardening-editor-*.png | pass |
| PL-10 fields | depth/queries/limits/caps/budgets | research-plan-editor.test.tsx | — | pass |
| PL-11 validation | inline + summary, blank numerics | research-plan-editor.test.tsx, plan-api.test.ts | — | pass |
| PL-12 approval | exact version/context, pending/error | approval.test.ts | workspace plan-approval-* (Approve vN) | pass |
| PL-13 progress | counts first, bounded search | sector-workspace.test.tsx | workspace | pass |
| PL-14 intake review | evidence/attempts/stale/idempotency | work-review.test.tsx, work-review-api.test.ts | work-review.spec L/D 390/1440 | pass |

## Global context (GC) — workspace-parts GlobalContextPanel

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| GC-01 panel | versioned doc, omit empties | sector-workspace.test.tsx | workspace-resources-*.png | pass |
| GC-02 proposals | count + labeled rows | sector-workspace.test.tsx | — | pass |
| GC-03 editor | 4 fields, frozen version, drafts kept | sector-workspace.test.tsx | — | pass |
| GC-04 proposal review | before/after by section | sector-workspace.test.tsx | — | pass |
| GC-05 approval | consequences, stale guard | approval.test.ts | — | pass |
| GC-06 history | bounded revisions | sector-workspace.test.tsx | — | pass |
| GC-07 file preview | hashes + 50-unit windows | sector-file-preview.test.tsx | file-processing | pass |

## Local context/compaction/inspection (LC) — LocalContextEditor, ExecutionInspector

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| LC-01 editor | task/notes/usage/recovery | sector-workspace.test.tsx | context-recovery.spec | pass |
| LC-02 usage | backend budget, exact-vs-est | sector-workspace.test.tsx | — | pass |
| LC-03 notes | dirty/retained/explicit save | sector-workspace.test.tsx | — | pass |
| LC-04 compaction | pending/result, never blank success | sector-workspace.test.tsx | context-recovery | pass |
| LC-05 pending response | quiet recovery notice | sector-workspace.test.tsx | receipt-inspection.png | pass |
| LC-06 operation cards | tool/reason/receipt/identity | sector-workspace.test.tsx | operation-recovery-*.png | pass |
| LC-07 safe rebuild | separated original/proposal + guard | sector-workspace.test.tsx | safe-rebuild-conflict.png | pass |
| LC-08 inspector dialog | metadata + detail layout | execution-inspection.test.tsx | execution-inspection.spec | pass |
| LC-09 records | 20/page, selection, versions | execution-inspection.test.tsx | execution-inspection.spec | pass |
| LC-10 JSON controls | download/more/count | execution-inspection.test.tsx | execution-inspection.spec | pass |

## Files/PDF (FL) — WorkspaceFiles, SectorFilePreview, FileProcessing*

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| FL-01 panel | header/search/visibility/count | sector-workspace.test.tsx, workspace-files-scale.test.tsx | files-scale 2005-record | pass (SearchField) |
| FL-02 rows | status/preview/hide/reveal | sector-workspace.test.tsx | files-scale | pass |
| FL-03 upload | 8MB + formats, no fake % | file-processing.test.tsx | files-db.spec (live-gated) | pass |
| FL-04 hide/reveal | hidden text, no bypass | sector-workspace.test.tsx | files-scale | pass |
| FL-05 include | request/review flow | sector-workspace.test.tsx | — | pass |
| FL-06 processing states | FileProcessingStatus: queued/reading/processing/paused/failed/uncertain/indexed | file-processing.test.tsx | file-processing.spec | pass |
| FL-07 retry dialog | FileProcessingRetry: pinned revision, dup-paid ack | file-processing.test.tsx | file-processing.spec | pass |
| FL-08 preview | provenance/download/bounded text | sector-file-preview.test.tsx | file-processing.spec | pass |
| FL-09 section paging | 20/page replace | sector-file-preview.test.tsx | file-processing.spec | pass |
| FL-10 missing original | honest retained-content copy | sector-file-preview.test.tsx | — | pass |
| FL-11 large library | 50+50 windows, truthful totals | workspace-files-scale.test.tsx | files-scale.spec | pass |

## Agents/runs/alerts (AG) — RunsPanel, SubagentsPanel, SupervisionAlertsPanel, RunConsole, AgentDirectory

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| AG-01 page | header + independent sections | runs-staging.test.tsx, supervision-alerts.test.tsx | matrix agents | pass |
| AG-02 runs | toolbar/list/footer, polling | runs-staging.test.tsx | visual wave2 | pass |
| AG-03 run rows | readable state + controls | runs-staging.test.tsx | wave2-runs-cancelling.png | pass (CANCELLING amber, never failed red) |
| AG-04 stop/cancel | confirm + pending + failure | runs-staging.test.tsx | — | pass |
| AG-05 alerts panel | current vs historical | supervision-alerts.test.tsx, alerts-api.test.ts | alerts.spec | pass |
| AG-06 alert rows | title/recovery/scope/links | supervision-alerts.test.tsx | alerts-long.png | pass |
| AG-07 subagents | strip + open/stop/tag | SubagentsPanel (covered via chat-staging) | — | pass |
| AG-08 directory | search/50-window/counts | — (SearchField shell-tested; rows reuse session patterns) | — | pass (SearchField adopted; no dedicated directory suite) |
| AG-09 console | timeline + steer targets + Review | RunConsole.test.tsx | plan-console (live-gated) | pass |

## Models (MO) — ModelsPanel.tsx, ModelToolbar.tsx

| ID | states | component tests | browser | status |
|---|---|---|---|---|
| MO-01 panel | session selector + draft vs saved | models-staging.test.tsx, models-api.test.ts | matrix models, revamp-evidence | revamp-models-select.png | pass (shared Select; "Configured", never "Live") |
| MO-02 provider card | configured/default/model/effort/save | models-staging.test.tsx | — | pass ("Configured", never "Live") |
| MO-03 selectors | catalogue-only | models-staging.test.tsx | visual chat-model-picker, revamp-evidence | pass (ModelsPanel on shared Select/checkbox; toolbar keeps its pinned custom menus by durable-behavior rule) |
| MO-04 reasoning/effort | disabled-with-reason, listed values | models-staging.test.tsx | — | pass |
| MO-05 toolbar | full names, search menu, effort popup | models-staging.test.tsx | transitions menu clip | pass |
| MO-06 save errors | local error + preserved selection | models-staging.test.tsx | — | pass |

## Legacy + shared utilities (N)

| component | treatment | tests | status |
|---|---|---|---|
| SectorDetailPage | legacy layout kept; shared rows/notices/dialogs | SectorDetailPage.test.tsx | pass |
| DocumentsSection | shared rows/fields/errors/upload states | SectorDetailPage.test.tsx | pass |
| SectorChatPanel | shared conversation styling/composer/activity | SectorChatPanel.test.tsx | pass |
| SectorPlanSection / PlanEdit | shared editor shell, legacy version behavior | SectorPlanSection.test.tsx | pass |
| SectorContextDrawer | legacy estimated view labeled; 60% claim + amber removed; not budget authority | SectorContextDrawer.test.tsx | pass |
| MeterBar / FileBlock | available estimates only, no invented window | SectorContextDrawer.test.tsx | pass |
| PanelError / UnavailableNotice / DeniedNotice | list-panel notice set; ResourceState is the canonical shell for new surfaces | Dashboard/ResearchesPage suites | pass |
| SkeletonRows | row-geometry skeletons | Dashboard.test.tsx | pass |
| StatusPill | delegates to Badge; button variant kept | StatusPill.test.tsx | pass |
| text.tsx | typed refs/IDs/tabIndex; scale pinned | text-primitives.test.tsx, typography.test.ts | pass |
| download helper | shared downloadBlob + visible errors | sector-file-preview.test.tsx | pass |
| navigation helper | URL fields + history preserved | navigation-url.test.tsx | pass |
| chat adapters/pure utils | grouping/merge/timestamp/mention/status | assistant-adapter, follow-resume, workspace-conversation, formatter suites | pass |

## Owned primitive inventory (2.2) — frontend/src/components/ui/

button (pending/disabled/destructive), input, textarea, field, select,
searchable (combobox), checkbox (indeterminate), switch, tabs, menu,
popover, dialog, alert-dialog (+ConfirmAction), tooltip, collapsible,
progress, badge, skeleton, separator. Pinned by ui-primitives.test.tsx,
shells.test.tsx, session-options.test.tsx, workspace-tabs.test.tsx.

## Nonvisual / compatibility classification

- `frontend/src/data/*`, `lib/download`, `lib/useNavigation`, `lib/utils`,
  staging/research/workspace API clients: covered by api/staging/model
  suites (staging-api, models-api, plan-api, work-review-api,
  alerts-api, no-hardcoded-staging) — no visual entry required.
- `chat/assistantAdapter`, grouping/timestamp/mention utilities: pinned by
  assistant-adapter, follow-resume, workspace-conversation, chat-parts suites.
- `chat/AssistantRuntimeAdapter`: headless external-store runtime provider,
  renders no DOM of its own; pinned by assistant-runtime.test.tsx and the
  chat/workspace conversation suites.
- Motion exit timing (`EXIT_MS`/`POPOVER_MS` + preset classes): pinned by
  motion-presets.test.tsx (durations, distances, reduced-motion guards).
- Live-gated (stated skips, never silent): plan-02/plan-03 journeys,
  files-db, agent-context-db, runtime-preflight, Meta pilot, Temporal/DB
  suites, 2,000-company campaign.

## Primitive adoption (enforced above: every adopter path must exist)

| primitive | adopted in |
|---|---|
| button/input/textarea/field | `frontend/src/components/ResearchesPage.tsx`, `frontend/src/components/ResearchPlanEditor.tsx`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/TopBar.tsx`, `frontend/src/components/workspace-parts.tsx` |
| select | `frontend/src/components/ResearchesPage.tsx`, `frontend/src/components/ModelsPanel.tsx`, `frontend/src/components/CompaniesSection.tsx` |
| tabs | `frontend/src/components/ResearchesPage.tsx` |
| dialog/alert-dialog | `frontend/src/components/ResearchesPage.tsx`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/SectorWorkspace.tsx`, `frontend/src/components/workspace-parts.tsx` |
| tooltip | `frontend/src/components/Sidebar.tsx` |
| collapsible | `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/ResearchPlanEditor.tsx`, `frontend/src/components/workspace-parts.tsx`, `frontend/src/components/SectorLanding.tsx` |
| progress | `frontend/src/components/workspace-parts.tsx`, `frontend/src/components/SectorLanding.tsx` |
| badge | `frontend/src/components/StatusPill.tsx`, `frontend/src/components/ModelsPanel.tsx` |
| skeleton | `frontend/src/components/research-parts.tsx` |
| checkbox | `frontend/src/components/ModelsPanel.tsx`, `frontend/src/components/workspace-parts.tsx` |
| separator | `frontend/src/components/shells.tsx` |
| text scale | `frontend/src/App.tsx`, `frontend/src/components/shells.tsx` |

No suitable surface (honest non-adoption, not silent gaps):

- `ui/menu`, `ui/popover`: the SessionsPanel, model menus, files menu, and
  mention/skill listboxes own durable positioning, dismissal choreography,
  and pinned focus contracts (`chat-staging`, `models-staging`,
  transitions clip). Transplanting them would risk that behavior for no
  user-visible gain.
- `ui/searchable`: no backend-supplied long-list selection exists outside
  the model menus above; short lists correctly use `ui/select`.
- `ui/switch`: no genuine boolean setting exists in the product UI;
  approval acknowledgment must never become a switch.

## UI v2 Stage 1 foundations (F1-F12)

| foundation | files | tests | status |
|---|---|---|---|
| F1 tokens (2.1/2.4 values, both themes) | `frontend/src/index.css` | tokens.test.ts, contrast.test.ts | pass |
| F2 theme system (system/light/dark, no-flash) | `frontend/src/lib/theme.ts`, `frontend/index.html` | theme.test.tsx | pass |
| F3 type primitives + usage sweep | `frontend/src/components/text.tsx` | text-primitives.test.tsx, type-usage.test.ts, typography.test.ts | pass |
| F4 primitive restyle (19 ui wrappers) | `frontend/src/components/ui/` | ui-primitives.test.tsx + v2/primitives.spec.ts (19 e2e, 2 skipped: collapsible/progress lack fixture anchors) | pass |
| F5 ListRow + interaction recipes | `frontend/src/components/ui/list.tsx`, `frontend/src/lib/interaction.ts` | list.test.tsx, interaction.test.ts | pass |
| F6 motion system (2.6 patterns) | `frontend/src/lib/motion.ts` | motion-presets.test.tsx | pass |
| F7 icon map + IconButton | `frontend/src/lib/icons.ts`, `frontend/src/components/IconButton.tsx` | icons.test.ts | pass |
| F8 toasts (sonner) | `frontend/src/lib/toast.ts` | toast.test.ts + v2/primitives.spec.ts toast shots | pass |
| F9 command palette (cmdk) | `frontend/src/components/CommandPalette.tsx` | command-palette.test.tsx + v2/primitives.spec.ts palette shots | pass |
| F10 data table (tanstack 8.21.3) | `frontend/src/components/DataTable.tsx` | data-table.test.tsx | pass |
| F11 shared state components | `frontend/src/components/shells.tsx` ResourceState | shells.test.tsx | pass |
| F12 humanized labels + format | `frontend/src/lib/labels.ts`, `frontend/src/lib/format.ts` | labels.test.ts, format.test.ts | pass |
| animate-number helper | `frontend/src/lib/animate-number.ts` | animate-number.test.tsx | pass |
| cn configured merger (custom font sizes) | `frontend/src/lib/utils.ts` | cn.test.ts | pass |
| e2e support (fixtures/api/shot/audit/color) | `tests/frontend-e2e/support/*` | color.test.ts, v2/audit.spec.ts (5 tests, 30 page/state/theme/width combos, zero violations) | pass |

F4 e2e evidence: `frontend/test-results/v2/F4-*.png` (76 shots, every primitive
x default/hover/focus/open/disabled/loading x light/dark x 1440/390, each opened
and reviewed). Known page-level findings carried into later stages (not
foundations defects): Models 390 "MetaServer default" wrap (Stage 6 MO-03),
blocky page-level loading skeletons (page loading states own layout mirroring),
raw "Filter" stage text + unlabeled bars (Stage 2 RS-05), old "New sector draft"
dialog copy (Stage 2 RS-06), static hover/focus shots show limited state
(covered by audit checks 6/8 + unit tests + Stage 8 videos).

## UI v2 Stage 2 shell + Overview + Researches (SH/OV/RS)

| ID | source | states | component tests | browser | evidence | status |
|---|---|---|---|---|---|---|
| SH-01 page frame + header | `frontend/src/App.tsx`, `frontend/src/components/shells.tsx` PageHeader | crumbs/badge/loading skeleton, no back links | shells.test.tsx, navigation-url.test.tsx | v2/shell.spec | — | pass (single max-w-page frame, pt-6/pb-12) |
| SH-02 sidebar | `frontend/src/components/Sidebar.tsx` | expanded/collapsed rail, sliding nav-active, persisted | Sidebar.test.tsx | v2/shell.spec | — | pass (Researches active on sector views; Emails Soon) |
| SH-03 top bar | `frontend/src/components/TopBar.tsx` | palette trigger, Ask Karbot, theme menu | TopBar.test.tsx | v2/shell.spec | — | pass (Overview search removed) |
| SH-04 theme menu | `frontend/src/components/ThemeMenu.tsx` | system/light/dark radio | theme-menu.test.tsx | v2/shell.spec | — | pass |
| SH-05 palette | `frontend/src/components/CommandPalette.tsx` | open/filtered/empty | command-palette.test.tsx | v2/shell.spec | — | pass (trigger in TopBar) |
| SH-06 toaster | sonner in `frontend/src/App.tsx` | success/error | toast.test.ts | v2/shell.spec | — | pass |
| SH-07 global app states | `frontend/src/App.tsx` not-connected branch | not-connected | Navigation.test.tsx | v2/shell.spec | — | pass (RS rewrite keeps the branch; SH-07 pass lands in Stage 6) |
| RS-06 new sector dialog | `frontend/src/components/CreateSectorDialog.tsx` | validation/pending/failure-keeps-draft, controlled triggerless mode | create-sector-dialog.test.tsx | v2/researches.spec | — | pass (single App-owned instance) |
| OV-01 header | `frontend/src/App.tsx` header config | title/description/action | research-staging.test.tsx | v2/overview.spec | — | pass |
| OV-02 stat tiles | `frontend/src/components/Dashboard.tsx` | ready/loading/error, count-up, filtered links | Dashboard.test.tsx | v2/overview.spec | — | pass |
| OV-04 recent sectors | `frontend/src/components/Dashboard.tsx` | rows/skeleton/empty/error/denied/offline | Dashboard.test.tsx, research-presentation.test.tsx | v2/overview.spec | — | pass |
| OV-05 recent companies | `frontend/src/components/Dashboard.tsx` | rows/skeleton/empty/error/denied/offline | Dashboard.test.tsx, research-presentation.test.tsx | v2/overview.spec | — | pass |
| RS-01 header | `frontend/src/App.tsx` header config | title/description/action | ResearchesPage.test.tsx | v2/researches.spec | — | pass |
| RS-02 tabs | `frontend/src/components/ResearchesPage.tsx` | counts, sliding indicator, URL sync | ResearchesPage.test.tsx, navigation-url.test.tsx | v2/researches.spec | — | pass |
| RS-03 toolbar | `frontend/src/components/ResearchesPage.tsx` | search debounce, status select, live counts | ResearchesPage.test.tsx | v2/researches.spec | — | pass |
| RS-04 sectors table | `frontend/src/components/ResearchesPage.tsx` + `frontend/src/components/DataTable.tsx` | sort/paging/empty/loading/error/denied/offline | ResearchesPage.test.tsx, data-table.test.tsx | v2/researches.spec | — | pass |
| RS-05 companies table | `frontend/src/components/ResearchesPage.tsx` + `frontend/src/components/DataTable.tsx` | server paging/more-error, no client sort | ResearchesPage.test.tsx, company-window.test.tsx | v2/researches.spec | — | pass |
| shared research presentation | `frontend/src/components/research-parts.tsx` StateBadge/StageSteps | tone map, humanized steps | research-presentation.test.tsx | v2/overview.spec, v2/researches.spec | — | pass |

## UI v2 Stage 3 sector landing (SL)

| ID | source | states | component tests | browser | evidence | status |
|---|---|---|---|---|---|---|
| SL-01 header | `frontend/src/App.tsx` header config | crumbs/badge/meta/actions, not-found title | sector-workspace.test.tsx (meta line), SectorDetailPage.test.tsx (App flow) | v2/landing.spec | — | pass |
| SL-02 status panel | `frontend/src/components/SectorLanding.tsx` | summary per state, estimate/finished/stopped/unestimated tiles, next-step routes | sector-workspace.test.tsx | v2/landing.spec | — | pass |
| SL-03 progress dialog | `frontend/src/components/SectorLanding.tsx` + `frontend/src/components/workspace-parts.tsx` WorkspaceOverlay/PlanProgress | controlled open, condensed plan, footer | sector-workspace.test.tsx, work-review.test.tsx | v2/landing.spec | — | pass |
| SL-05 companies | `frontend/src/components/CompaniesSection.tsx` | toolbar/paging/poll/empties/more-error/denied | companies-section.test.tsx | v2/landing.spec | — | pass |
| SL-06 not found/denied | `frontend/src/components/SectorLanding.tsx` | not-found way back, shared notice states | sector-workspace.test.tsx | v2/landing.spec | — | pass |
| SL view param | `frontend/src/lib/useNavigation.ts` + `frontend/src/components/SectorWorkspace.tsx` initialView | ?view=plan deep link, SectorChat scoping | use-navigation.test.tsx | v2/landing.spec | — | pass |
