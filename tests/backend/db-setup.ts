import type { TestProject } from 'vitest/node'
import { prepareTestTemplate, TEMPLATE_RUN_ENV } from './db-helper.js'

export default async function setup(project: TestProject): Promise<void> {
  const runId = project.config.env[TEMPLATE_RUN_ENV]
  if (typeof runId !== 'string') throw new Error('Missing test template run identity')
  await prepareTestTemplate(runId)
}
