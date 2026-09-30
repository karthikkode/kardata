// Product skill registry: named reusable capabilities Karbot can invoke
// via slash commands. A skill is a prompt plus the exact tool names it may
// use — invocation grants only those tools (skill-scoped least privilege),
// and sensitive tools additionally need explicit user confirmation in the
// conversation before the model calls them.
import type { TurnMode } from './prompt.js'
export interface Skill {
  /** Slash name, lowercase letters and dashes only. */
  name: string
  /** One-line picker description. */
  description: string
  /** Prompt block composed after the standing facts (see prompt.ts). */
  prompt: string
  /** Exact MCP tool names this skill may call. Fail-closed allowlist. */
  tools: string[]
  /** Turn mode this skill runs in. Brainstorm skills get the open posture,
   * lower effort, sampling temperature, and KB preload. */
  mode?: TurnMode
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export function isValidSkillName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

const SKILLS: Skill[] = [
  {
    name: 'brainstorm',
    description: 'Open product discussion: sectors, companies, strategy.',
    prompt:
      'Brainstorming mode: discuss freely and creatively like a thought partner, not a form. ' +
      'Explore the idea from several angles, ask sharp follow-up questions, and ground claims about ' +
      'what Kardata sells, pricing, the ideal customer, or method in the preloaded reference material ' +
      'or db.kb_search — cite sources. Never invent research or metrics. When the user settles on a ' +
      'new sector, summarize it crisply and offer to draft it via the sector-draft skill; do not ' +
      'create anything without an explicit go-ahead.',
    tools: ['db.kb_search', 'db.list_sectors', 'db.get_sector', 'db.list_companies', 'db.ledger_list_companies'],
    mode: 'brainstorm',
  },
  {
    name: 'plan',
    description: 'Structure a roadmap and checklist before taking action.',
    prompt:
      'Plan mode: break down complex tasks into numbered milestones and clear checklists. ' +
      'Identify requirements, open questions, dependencies, and risk factors. ' +
      'Do not execute destructive mutations without operator sign-off.',
    tools: [
      'db.list_sectors',
      'db.get_sector',
      'db.list_companies',
      'db.ledger_list_companies',
      'db.kb_search',
      'db.query_document',
      'db.create_artifact',
    ],
    mode: 'plan',
  },
  {
    name: 'sector-draft',
    description: 'Draft a new sector for later research (never auto-starts).',
    prompt:
      'Sector-draft flow: help shape the sector (name, scope, why-now), then propose the draft and ' +
      'wait for an explicit go-ahead before calling db.create_sector. Creating a draft never starts ' +
      'research — tell the user research begins only when they press start or say so. Context files ' +
      'can be attached to the draft afterwards; never claim files were read that were not returned ' +
      'by a tool.',
    tools: [
      'db.create_sector',
      'db.get_sector',
      'db.list_sectors',
      'db.kb_search',
      'db.attach_sector_document',
      'db.list_sector_documents',
    ],
  },
]

const BY_NAME = new Map(SKILLS.map((skill) => [skill.name, skill]))

/** Every registered skill, in picker order. */
export function listSkills(): Skill[] {
  return [...SKILLS]
}

/** One skill by slash name, undefined for unknown names. */
export function getSkill(name: string): Skill | undefined {
  return BY_NAME.get(name)
}
