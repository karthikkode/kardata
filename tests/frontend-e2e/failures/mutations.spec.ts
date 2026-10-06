// Mutation failure matrix (P6.4): mutating endpoints x 9 faults. Verified
// cases assert the designed error UI + draft kept, then heal via retry or
// re-trigger. Unverified cases (cancel/settings/spawn/restore: trigger
// proven, error UI not) assert chrome + console + shot. Skipped endpoints
// (no mapped UI trigger without a live run, or state-gated): steer,
// pause/resume-run commands, approve command, plan create/edit/approve,
// sector start/restart, context save/compact/files/decisions,
// files PATCH/retry, local compact, queue surgery, proposal/fileUnits
// GETs, rewrite — listed with reasons in the Phase 6 review package.
import { test } from '@playwright/test'
import { FAULTS, runFault, type FaultCase } from '../support/failures'
import type { MatrixSetup } from '../support/matrix'

test.describe.configure({ timeout: 120_000 })

const DOCK = [{ click: { kind: 'role', role: 'button', name: 'Ask Karbot' } }] as const
const TRY_AGAIN = { kind: 'role', role: 'button', name: 'Try again' } as const
const CHAT = '/?section=SectorChat&sector=sector-matrix&session=mx-session-001&thread=mx-session-001'
const RESEARCH_CHAT = '/?section=SectorChat&sector=sector-matrix&session=session-sector-matrix-research&thread=session-sector-matrix-research'
const OPTIONS_MENU: MatrixSetup[] = [
  { click: { kind: 'role', role: 'button', name: 'Conversation options' } },
]

const CASES: FaultCase[] = [
  {
    id: 'frontend.src.components.SectorWorkspace', label: 'POST /v1/commands/send', method: 'POST',
    pattern: /\/commands\/send/, route: CHAT,
    errorAnchors: [
      { kind: 'text', text: 'That reply did not go through.' },
      { kind: 'role', role: 'button', name: 'Retry', exact: true },
    ],
    deniedAnchors: [
      { kind: 'text', text: 'That reply did not go through.' },
      { kind: 'role', role: 'button', name: 'Retry', exact: true },
    ],
    errorContent: [{ kind: 'text', text: 'fault-probe message' }],
    baseAnchors: [{ kind: 'role', role: 'textbox', name: 'Message this conversation' }],
    healAnchors: [{ kind: 'text', text: 'fault-probe message' }],
    retry: { kind: 'role', role: 'button', name: 'Retry', exact: true },
    deniedRetry: { kind: 'role', role: 'button', name: 'Retry', exact: true },
    draftFill: { kind: 'role', role: 'textbox', name: 'Message this conversation' }, draftText: 'fault-probe message',
    draftConsumed: true,
    refetch: { steps: [{ press: 'Enter' }] },
  },
  {
    id: 'frontend.src.components.chat.ChatHeader', label: 'POST session rename', method: 'POST',
    pattern: /\/rename/, route: '/',
    setup: [
      ...DOCK,
      { click: { kind: 'role', role: 'button', name: 'More actions' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Rename' } },
    ],
    errorAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Could not rename. Try again.' },
    ],
    deniedAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Could not rename. This key cannot rename chats.' },
    ],
    baseAnchors: [{ kind: 'css', css: '#karbot-rename-name' }],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'text', text: 'Renamed!' },
    ],
    healRetrigger: true,
    draftFill: { kind: 'css', css: '#karbot-rename-name' }, draftText: 'Renamed!',
    draftConsumed: true,
    refetch: { steps: [{ click: { kind: 'role', role: 'button', name: 'Save' } }] },
  },
  {
    id: 'frontend.src.components.chat.ChatHeader', label: 'DELETE session', method: 'DELETE',
    pattern: /\/v1\/sessions\/[^/]+$/, route: '/',
    setup: [...DOCK],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Could not delete. This key cannot delete chats.' },
    ],
    healAnchors: [{ kind: 'role', role: 'complementary', name: 'Assistant chat' }],
    healRetrigger: true,
    healSteps: [{ click: { kind: 'role', role: 'button', name: 'Delete conversation' } }],
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'More actions' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Delete' } },
      { click: { kind: 'role', role: 'button', name: 'Delete conversation' } },
    ] },
  },
  {
    id: 'frontend.src.components.SectorWorkspace', label: 'POST sector pause', method: 'POST',
    pattern: /\/pause/, route: RESEARCH_CHAT,
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'role', role: 'alert' }],
    baseAnchors: [{ kind: 'role', role: 'button', name: 'Pause' }],
    healAnchors: [{ kind: 'role', role: 'button', name: 'Resume' }],
    healRetrigger: true,
    refetch: { steps: [{ click: { kind: 'role', role: 'button', name: 'Pause' } }] },
  },
  {
    id: 'frontend.src.components.SectorWorkspace', label: 'POST sector resume', method: 'POST',
    pattern: /\/resume/, route: RESEARCH_CHAT,
    setup: [{ click: { kind: 'role', role: 'button', name: 'Pause' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'role', role: 'alert' }],
    baseAnchors: [{ kind: 'role', role: 'button', name: 'Resume' }],
    healAnchors: [{ kind: 'role', role: 'button', name: 'Pause' }],
    healRetrigger: true,
    refetch: { steps: [{ click: { kind: 'role', role: 'button', name: 'Resume' } }] },
  },
  {
    id: 'frontend.src.components.chat.SessionsPanel', label: 'POST /v1/sessions', method: 'POST',
    pattern: /\/v1\/sessions$/, route: '/',
    setup: [...DOCK],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'role', role: 'alert' }],
    healAnchors: [
      { kind: 'role', role: 'complementary', name: 'Assistant chat' },
      { kind: 'role', role: 'log', name: 'Chat messages' },
    ],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [
      { click: { kind: 'css', css: '[aria-label="Chat sessions"]' } },
      { click: { kind: 'text', text: 'New chat' } },
    ] },
  },
  {
    id: 'frontend.src.components.ModelToolbar', label: 'PATCH session model', method: 'PATCH',
    pattern: /\/model/, route: CHAT,
    errorAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'The model did not save. Check your connection and try again.' },
    ],
    deniedAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'The model did not save. Check your connection and try again.' },
    ],
    healAnchors: [{ kind: 'css', css: '[aria-label="Choose a model"]' }],
    retry: TRY_AGAIN, deniedRetry: TRY_AGAIN,
    refetch: { steps: [
      { click: { kind: 'css', css: '[aria-label="Choose a model"]' } },
      { click: { kind: 'text', text: 'Muse Spark 1.3 Compact' } },
    ] },
  },
  {
    id: 'frontend.src.components.local_context_editor', label: 'PATCH thread context', method: 'PATCH',
    pattern: /\/v1\/threads\/[^/]+\/context$/, route: CHAT,
    setup: [
      ...OPTIONS_MENU,
      { click: { kind: 'role', role: 'menuitem', name: 'Local context' } },
    ],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'role', role: 'alert' }],
    healAnchors: [{ kind: 'text', text: 'Local context' }],
    healRetrigger: true,
    draftFill: { kind: 'role', role: 'textbox', name: 'Local notes' }, draftText: 'my notes',
    refetch: { steps: [{ click: { kind: 'role', role: 'button', name: 'Save notes' } }] },
  },
  {
    id: 'frontend.src.components.local_context_editor', label: 'POST context rebuild', method: 'POST',
    pattern: /\/rebuild/, route: CHAT,
    apiData: { localVariant: 'blocked' },
    setup: [
      ...OPTIONS_MENU,
      { click: { kind: 'role', role: 'menuitem', name: 'Local context' } },
    ],
    // The blocked-state alert (div) is permanent base UI; the form
    // failure is the p alert inside the rebuild form.
    errorAnchors: [{ kind: 'css', css: 'p[role="alert"]' }],
    deniedAnchors: [{ kind: 'css', css: 'p[role="alert"]' }],
    healAnchors: [{ kind: 'text', text: 'Local context' }],
    healRetrigger: true,
    healSteps: [{ click: { kind: 'role', role: 'button', name: 'Confirm safe rebuild' } }],
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'Review safe rebuild' } },
      { fill: { kind: 'role', role: 'textbox', name: 'Independent replacement' }, text: 'rebuild summary text' },
      { click: { kind: 'css', css: '[aria-label="I reviewed this replacement"]' } },
      { click: { kind: 'role', role: 'button', name: 'Confirm safe rebuild' } },
    ] },
  },
  {
    id: 'frontend.src.components.ChatPanel', label: 'POST session compact', method: 'POST',
    pattern: /\/sessions\/[^/]+\/compact/, route: '/',
    setup: [...DOCK],
    errorAnchors: [{ kind: 'text', text: 'Compaction failed. Check connection.' }],
    deniedAnchors: [{ kind: 'text', text: 'Compaction failed. Check connection.' }],
    healAnchors: [{ kind: 'role', role: 'status' }],
    healRetrigger: true,
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'More actions' } },
      { click: { kind: 'role', role: 'menuitem', name: 'Compact context' } },
    ] },
  },
  {
    id: 'frontend.src.components.CreateSectorDialog', label: 'POST /v1/sectors', method: 'POST',
    pattern: /\/v1\/sectors$/, route: '/?section=Researches',
    setup: [{ click: { kind: 'role', role: 'button', name: 'New sector' } }],
    errorAnchors: [{ kind: 'role', role: 'alert' }],
    deniedAnchors: [{ kind: 'role', role: 'alert' }],
    baseAnchors: [{ kind: 'role', role: 'dialog', name: 'New sector' }],
    // A successful create navigates to the new sector's detail page,
    // so the healed state is the sector heading, not the list heading.
    healAnchors: [{ kind: 'role', role: 'heading', name: 'Fault Sector' }],
    healAbsent: [{ kind: 'role', role: 'dialog', name: 'New sector' }],
    healRetrigger: true,
    draftFill: { kind: 'role', role: 'textbox', name: 'Name' }, draftText: 'Fault Sector',
    draftConsumed: true,
    // The form has two inputs and no submit button, so Enter never
    // submits; the explicit button is the trigger.
    refetch: { steps: [{ click: { kind: 'role', role: 'button', name: 'Create sector' } }] },
  },
  {
    id: 'frontend.src.components.chat.SessionFiles', label: 'POST session artifact', method: 'POST',
    pattern: /\/artifacts/, route: '/',
    setup: [...DOCK, { click: { kind: 'role', role: 'button', name: 'Session files' } }],
    errorAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Could not create the file.' },
    ],
    deniedAnchors: [
      { kind: 'role', role: 'alert' },
      { kind: 'text', text: 'Could not create the file.' },
    ],
    healAnchors: [{ kind: 'css', css: '[aria-label="Session files"]' }],
    healRetrigger: true,
    healSteps: [{ click: { kind: 'role', role: 'button', name: 'Create file' } }],
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'New file' } },
      { press: 'x' },
      { press: 'x' },
      { press: 'x' },
      { click: { kind: 'role', role: 'button', name: 'Create file' } },
    ] },
  },
  {
    id: 'frontend.src.components.RunsPanel', label: 'POST /v1/commands/cancel', method: 'POST',
    pattern: /\/commands\/cancel/, route: '/?section=Agents',
    healAnchors: [{ kind: 'role', role: 'region', name: 'Runs' }],
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'Cancel' } },
      { click: { kind: 'role', role: 'button', name: 'Cancel run' } },
    ] },
    unverified: true,
  },
  {
    id: 'frontend.src.components.SectorWorkspace', label: 'PATCH session settings', method: 'PATCH',
    pattern: /\/settings/, route: CHAT,
    healAnchors: [{ kind: 'role', role: 'button', name: 'Conversation options' }],
    refetch: { steps: [
      ...OPTIONS_MENU,
      { click: { kind: 'css', css: '[data-slot="switch"]' } },
    ] },
    unverified: true,
  },
  {
    id: 'frontend.src.components.SectorWorkspace', label: 'POST session subagents', method: 'POST',
    pattern: /\/subagents/, route: CHAT,
    healAnchors: [{ kind: 'role', role: 'button', name: 'New subagent' }],
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'New subagent' } },
      { fill: { kind: 'role', role: 'textbox', name: 'Goal' }, text: 'fault probe goal' },
      { click: { kind: 'role', role: 'button', name: 'Start subagent' } },
    ] },
    unverified: true,
  },
  {
    id: 'frontend.src.components.global_context_panel', label: 'POST context restore', method: 'POST',
    pattern: /\/restore/, route: CHAT,
    healAnchors: [{ kind: 'css', css: '[aria-label="Global context"]' }],
    refetch: { steps: [
      { click: { kind: 'role', role: 'button', name: 'Context history' } },
      { click: { kind: 'role', role: 'button', name: 'Research agent 2 · v2' } },
      { click: { kind: 'role', role: 'button', name: 'Restore this version' } },
      { click: { kind: 'role', role: 'button', name: 'Restore version' } },
    ] },
    unverified: true,
  },
]

for (const fc of CASES) {
  for (const fault of FAULTS) {
    test(`[F:${fc.id}] failure ${fc.label} ${fault}`, async ({ page }) => {
      await runFault(page, fc, fault)
    })
  }
}
