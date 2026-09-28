// Prompt composition for Karbot turns. The seam every skill, mode, and
// preload flows through: standing facts first (never overridden), then the
// skill prepend, then the mode prompt, then preloaded reference chunks,
// joined as stable labeled sections. Deterministic string assembly only.
export interface PromptParts {
  /** Skill prompt: what this invocation is for and how to behave. */
  prepend?: string[]
  /** Mode prompt: e.g. brainstorm vs default answering posture. */
  modePrompt?: string
  /** Preloaded reference chunks: product corpus or attached context. */
  preload?: string[]
}

function clean(parts: string[] | undefined): string[] {
  return (parts ?? []).map((part) => part.trim()).filter((part) => part.length > 0)
}

/** Turn modes. `default` is the precise assistant; `brainstorm` is the
 * open thought partner for sectors, companies, and strategy. */
export type TurnMode = 'default' | 'brainstorm'

export const BRAINSTORM_MODE_PROMPT =
  'Brainstorming posture: think out loud like a creative thought partner. ' +
  'Offer divergent angles before converging, ask the sharp question the user has not asked, ' +
  'and prefer a lively specific reply over a safe generic one. Stay grounded: product claims ' +
  'cite the reference material, and anything unknowable is labeled a guess, never a fact.'

/** Mode prompt text, empty for the default posture. */
export function modePromptFor(mode: TurnMode): string {
  return mode === 'brainstorm' ? BRAINSTORM_MODE_PROMPT : ''
}

/** Compose the full system prompt. Order is the contract: base facts,
 * skill prepend, mode, preloaded references. Tested in prompt.test.ts. */
export function composeSystemPrompt(base: string, parts: PromptParts = {}): string {
  const sections = [base.trim()]
  for (const block of clean(parts.prepend)) sections.push(block)
  if (parts.modePrompt !== undefined && parts.modePrompt.trim().length > 0) {
    sections.push(parts.modePrompt.trim())
  }
  const chunks = clean(parts.preload)
  if (chunks.length > 0) {
    sections.push(`Reference material (authoritative for this turn):\n${chunks.join('\n---\n')}`)
  }
  return sections.join('\n\n')
}
