// Components-facing skills seam: the skill catalogue as a real hook
// (state + error + retry), never a re-exported api call.
import type { StagingConfig } from './api/client'
import { listSkills, type SkillSummary } from './api/skills'
import { useResource, type ResourceStatus } from './useResource'

export type { SkillSummary } from './api/skills'

export function useSkillsList(
  config: StagingConfig | null,
  options: { onData?: (skills: SkillSummary[]) => void } = {},
): {
  data: SkillSummary[] | undefined
  status: ResourceStatus
  reload: () => void
} {
  const key = config ? `${config.baseUrl} ${config.apiKey}` : null
  return useResource(() => (config ? listSkills(config) : null), key, options.onData)
}
