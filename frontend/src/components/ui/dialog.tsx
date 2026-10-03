// Owned dialog over Base UI: focus trap, title/description pairing, body
// scroll with a persistent footer, and trigger restoration are
// primitive-owned. Controlled callers pass open/onOpenChange; the exit
// animation is the single owner of unmount timing (see motion presets).
import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TooltipPopup, TooltipRoot, TooltipTrigger } from './tooltip'

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
  // Initial focus lands on the popup itself, never on the corner close:
  // auto-focusing the close would pop its tooltip uninvited and steal the
  // first Escape (nested floating behavior). Tab order is unchanged.
  const popupRef = React.useRef<HTMLDivElement | null>(null)
  return (
    <Dialog.Portal data-slot="dialog-portal">
      <Dialog.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-overlay transition-opacity duration-180 ease-out-soft data-[ending-style]:opacity-0 data-[ending-style]:duration-120 data-[starting-style]:opacity-0"
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
          ref={popupRef}
          initialFocus={popupRef}
          className={cn(
            side
              ? 'pointer-events-auto flex h-dvh max-h-dvh w-[min(92vw,480px)] flex-col overflow-hidden rounded-l-xl border border-border bg-popover shadow-lg outline-none transition-all duration-240 ease-out data-[ending-style]:opacity-0 data-[ending-style]:duration-180 data-[starting-style]:translate-x-4 data-[starting-style]:opacity-0'
              : 'pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-120 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg outline-none transition-all duration-180 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-120 data-[starting-style]:translate-y-1 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0',
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
      className={cn('flex shrink-0 items-start gap-3 px-5 pt-5 pb-2', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      data-slot="dialog-title"
      className={cn('min-w-0 flex-1 text-base font-medium text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      data-slot="dialog-description"
      className={cn('mt-1 text-ui text-muted-foreground', className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('scroll-slim min-h-0 flex-1 overflow-y-auto px-5 py-2', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 pt-4 pb-5',
        className,
      )}
      {...props}
    />
  )
}

function DialogClose({ className, ...props }: React.ComponentProps<typeof Dialog.Close>) {
  return (
    <TooltipRoot>
      <TooltipTrigger
        render={
          <Dialog.Close
            data-slot="dialog-close"
            aria-label="Close dialog"
            className={cn(
              'flex size-8 pointer-coarse:size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-120 ease-out-soft hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
              className,
            )}
            {...props}
          />
        }
      >
        <X aria-hidden />
      </TooltipTrigger>
      <TooltipPopup>Close dialog</TooltipPopup>
    </TooltipRoot>
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
