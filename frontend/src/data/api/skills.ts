// Skills API: registered product skills for the chat slash picker.
import { request, type StagingConfig } from './client'

export interface SkillSummary {
  name: string
  description: string
  tools: string[]
}

/** Registered product skills for the chat slash picker. */
export function listSkills(config: StagingConfig): Promise<SkillSummary[]> {
  return request<SkillSummary[]>(config, 'GET', '/v1/skills')
}
