import { describe, expect, it } from 'vitest'
import { isSharedUiFile, specFor } from '../../scripts/ui-review.mjs'

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

  it('treats tokens/lib/hooks/styles as shared (full matrix)', () => {
    expect(isSharedUiFile('frontend/src/lib/tokens.ts')).toBe(true)
    expect(isSharedUiFile('frontend/src/lib/labels.ts')).toBe(true)
    expect(isSharedUiFile('frontend/src/data/useWorkspace.ts')).toBe(true)
    expect(isSharedUiFile('frontend/src/data/api/threads.ts')).toBe(true)
    expect(isSharedUiFile('frontend/src/components/chat/useChatSync.ts')).toBe(true)
    expect(isSharedUiFile('frontend/src/components/chat/messages.ts')).toBe(true)
    expect(isSharedUiFile('frontend/src/index.css')).toBe(true)
  })

  it('leaves components and non-UI files unshared', () => {
    expect(isSharedUiFile('frontend/src/components/chat/ChatLog.tsx')).toBe(false)
    expect(isSharedUiFile('backend/src/db/threads.ts')).toBe(false)
    expect(isSharedUiFile('documentation/frontend.md')).toBe(false)
  })
})
