// Slash-command parsing and skill resolution for Karbot chat. A leading
// `/name` addresses a registered product skill; anything else is plain chat
// text. Parsing lives server-side (routes/commands.ts) so a spoofed client
// can never smuggle a skill invocation past validation as literal text.
import { getSkill, isValidSkillName, listSkills, type Skill } from '@kardata/agents'

export interface SlashCommand {
  name: string
  /** Text after the skill name (may be empty). */
  rest: string
}

/** Split a leading `/name ...` off chat text. Returns undefined for plain
 * text (including a lone `/`). */
export function parseSlashCommand(text: string): SlashCommand | undefined {
  if (!text.startsWith('/')) return undefined
  const match = /^\/([A-Za-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return undefined
  return { name: match[1] ?? '', rest: (match[2] ?? '').trim() }
}

/** Resolve a parsed slash command to its skill, or an error describing why
 * it is not invocable (unknown name or malformed). */
export function resolveSlashCommand(
  command: SlashCommand,
): { skill: Skill } | { error: string } {
  if (!isValidSkillName(command.name) || !getSkill(command.name)) {
    const known = listSkills().map((skill) => `/${skill.name}`).join(', ')
    return { error: `unknown skill /${command.name}; available: ${known}` }
  }
  const skill = getSkill(command.name)
  if (!skill) {
    return { error: `unknown skill /${command.name}` }
  }
  return { skill }
}
