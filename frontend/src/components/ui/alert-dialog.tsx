// Explicit destructive/irreversible confirmation over Base UI AlertDialog.
// Never approve a versioned plan or delete a session through a generic
// confirmation disconnected from the shown payload: ConfirmAction always
// renders the exact title/description/consequences it was given.
import * as React from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { cn } from 'cn'
import { useTopmostOverlay } from '@/lib/overlay'
import { Button } from './button'

function AlertDialogRoot(props: React.ComponentProps<typeof AlertDialog.Root>) {
  return <AlertDialog.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ className, ...props }: React.ComponentProps<typeof AlertDialog.Trigger>) {
  return <AlertDialog.Trigger data-slot="alert-dialog-trigger" className={className} {...props} />
}

export { AlertDialogRoot, AlertDialogTrigger }

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
          className="fixed inset-0 z-50 bg-black/40 transition-opacity ease-out duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-black/60"
        />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <AlertDialog.Popup
            data-slot="alert-dialog-popup"
            className={cn(
              'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl outline-none transition ease-out duration-200 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0',
            )}
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pt-5">
              <AlertDialog.Title
                data-slot="alert-dialog-title"
                className="min-w-0 flex-1 text-base font-semibold tracking-tight"
              >
                {title}
              </AlertDialog.Title>
            </div>
            <AlertDialog.Description
              data-slot="alert-dialog-description"
              className="scroll-slim min-h-0 overflow-y-auto px-5 py-3 text-sm text-muted-foreground"
            >
              {description}
            </AlertDialog.Description>
            {error ? (
              <p role="alert" className="mx-5 mb-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 py-4">
              <AlertDialog.Close
                data-slot="alert-dialog-cancel"
                className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {cancelLabel}
              </AlertDialog.Close>
              <Button variant="destructive" disabled={working} onClick={() => void confirm()}>
                {working ? 'Working…' : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
