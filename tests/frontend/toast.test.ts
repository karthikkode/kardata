import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { notify } from '@/lib/toast'

vi.mock('sonner', () => {
  const toastFn = vi.fn()
  return {
    toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  }
})

describe('toast helper (F8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows success and info for four seconds', () => {
    notify.success('Sector created')
    expect(toast.success).toHaveBeenCalledWith('Sector created', { duration: 4000 })
    notify.info('Plan saved as v3')
    expect(toast).toHaveBeenCalledWith('Plan saved as v3', { duration: 4000 })
  })

  it('shows warnings for four seconds', () => {
    notify.warning('Research is paused')
    expect(toast.warning).toHaveBeenCalledWith('Research is paused', { duration: 4000 })
  })

  it('shows errors for eight seconds with an optional action', () => {
    notify.error('That did not go through')
    expect(toast.error).toHaveBeenCalledWith('That did not go through', { duration: 8000 })
    const onClick = vi.fn()
    notify.error('Upload failed', { label: 'Retry', onClick })
    expect(toast.error).toHaveBeenCalledWith('Upload failed', {
      duration: 8000,
      action: { label: 'Retry', onClick },
    })
  })
})
