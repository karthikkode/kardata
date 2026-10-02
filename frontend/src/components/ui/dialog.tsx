// Owned dialog over Base UI: focus trap, title/description pairing, body
// scroll with a persistent footer, and trigger restoration are
// primitive-owned. Controlled callers pass open/onOpenChange; the exit
// animation is the single owner of unmount timing (see motion presets).
import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from 'cn'

function DialogRoot(props: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ className, ...props }: React.ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger data-slot="dialog-trigger" className={className} {...props} />
}

function DialogPopup({
  className,
  children,
  side = false,
  ...props
}: React.ComponentProps<typeof Dialog.Popup> & { side?: boolean }) {
  return (
    <Dialog.Portal data-slot="dialog-portal">
      <Dialog.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-black/40 transition-opacity ease-out duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-black/60"
      />
      <div
        className={
          side
            ? 'pointer-events-none fixed inset-0 z-50 flex justify-end'
            : 'pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center'
        }
      >
        <Dialog.Popup
          data-slot="dialog-popup"
          className={cn(
            side
              ? 'pointer-events-auto flex h-dvh max-h-dvh w-[min(92vw,360px)] flex-col overflow-hidden rounded-l-2xl border border-border bg-background shadow-xl outline-none transition ease-out duration-200 data-[ending-style]:translate-x-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-x-4 data-[starting-style]:opacity-0'
              : 'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl outline-none transition ease-out duration-200 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </Dialog.Popup>
      </div>
    </Dialog.Portal>
  )
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex shrink-0 items-start gap-3 border-b border-border px-5 py-4', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      data-slot="dialog-title"
      className={cn('min-w-0 flex-1 text-base font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      data-slot="dialog-description"
      className={cn('mt-1 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-4', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4',
        className,
      )}
      {...props}
    />
  )
}

function DialogClose({ className, ...props }: React.ComponentProps<typeof Dialog.Close>) {
  return (
    <Dialog.Close
      data-slot="dialog-close"
      aria-label="Close dialog"
      className={cn(
        'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      <X aria-hidden />
    </Dialog.Close>
  )
}

export {
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
}
