// Explicit destructive/irreversible confirmation over Base UI AlertDialog.
// Never approve a versioned plan or delete a session through a generic
// confirmation disconnected from the shown payload: ConfirmAction always
// renders the exact title/description/consequences it was given.
import * as React from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTopmostOverlay } from '@/lib/overlay'
import { Button } from './button'

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  pending = false,
  error = null,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  pending?: boolean
  error?: string | null
  onConfirm: () => void | Promise<void>
}) {
  const [busy, setBusy] = React.useState(false)
  const topmost = useTopmostOverlay(open)
  async function confirm() {
    if (busy || pending) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }
  const working = busy || pending
  return (
    <AlertDialog.Root data-slot="alert-dialog" open={open} onOpenChange={(next) => { if (!next) topmost.guard(() => onOpenChange(false)) }}>
      <AlertDialog.Portal data-slot="alert-dialog-portal">
        <AlertDialog.Backdrop
          data-slot="alert-dialog-backdrop"
          className="fixed inset-0 z-50 bg-overlay transition-opacity duration-180 ease-out-soft data-[ending-style]:opacity-0 data-[ending-style]:duration-120 data-[starting-style]:opacity-0"
        />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <AlertDialog.Popup
            data-slot="alert-dialog-popup"
            className={cn(
              'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-120 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg outline-none transition-all duration-180 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-120 data-[starting-style]:translate-y-1 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0',
            )}
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-2">
              <AlertDialog.Title
                data-slot="alert-dialog-title"
                className="min-w-0 flex-1 text-base font-medium text-foreground"
              >
                {title}
              </AlertDialog.Title>
            </div>
            <AlertDialog.Description
              data-slot="alert-dialog-description"
              className="scroll-slim min-h-0 overflow-y-auto px-5 py-2 text-ui text-muted-foreground"
            >
              {description}
            </AlertDialog.Description>
            {error ? (
              <p role="alert" className="mx-5 mt-2 flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3 text-ui text-danger">
                <CircleAlert aria-hidden className="size-4 shrink-0" />
                {error}
              </p>
            ) : null}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 pt-4 pb-5">
              <AlertDialog.Close
                data-slot="alert-dialog-cancel"
                render={<Button variant="secondary">{cancelLabel}</Button>}
              />
              <Button variant="destructive" pending={working} onClick={() => void confirm()}>
                {working ? 'Working…' : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
