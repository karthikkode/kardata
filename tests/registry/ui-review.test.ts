import { describe, expect, it } from 'vitest'
import { specFor } from '../../scripts/ui-review.mjs'

describe('ui:review --changed selection', () => {
  it('maps component files to their matrix specs', () => {
    expect(specFor('frontend/src/components/SectorWorkspace.tsx')).toBe('SectorWorkspace.spec.ts')
    expect(specFor('frontend/src/components/chat/ChatLog.tsx')).toBe('chat-ChatLog.spec.ts')
    expect(specFor('frontend/src/components/ui/button.tsx')).toBe('ui-button.spec.ts')
  })

  it('ignores non-component files', () => {
    expect(specFor('frontend/src/data/useWorkspace.ts')).toBeNull()
    expect(specFor('frontend/src/lib/labels.ts')).toBeNull()
    expect(specFor('backend/src/db/threads.ts')).toBeNull()
    expect(specFor('documentation/frontend.md')).toBeNull()
  })
})
