// Transient action outcomes only (plan F8): success and failure toasts
// for user actions. Errors that block a form stay inline; region-level
// failures use the ResourceState anatomy, never a toast.
import { toast } from 'sonner'

export const notify = {
  success(message: string): void {
    toast.success(message, { duration: 4000 })
  },
  error(message: string, action?: { label: string; onClick: () => void }): void {
    toast.error(message, {
      duration: 8000,
      ...(action ? { action: { label: action.label, onClick: action.onClick } } : {}),
    })
  },
  info(message: string): void {
    toast(message, { duration: 4000 })
  },
  warning(message: string): void {
    toast.warning(message, { duration: 4000 })
  },
}
