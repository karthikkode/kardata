import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
 DialogBody,
 DialogClose,
 DialogFooter,
 DialogHeader,
 DialogPopup,
 DialogRoot,
 DialogTitle,
} from './ui/dialog'
import { ResourceState } from './shells'
import { EXIT_MS, prefersReducedMotion } from '../lib/motion'
import { useTopmostOverlay } from '../lib/overlay'
import type { Resource } from '../data/useWorkspace'

export function WorkspaceOverlay({ title, titleBadge, children, onClose, side = false, footer, open = true, size = 'default', popupClassName, initialFocus }: { title: string; titleBadge?: ReactNode; children: ReactNode; onClose(): void; side?: boolean; footer?: ReactNode; open?: boolean; size?: 'default' | 'large' | 'small'; popupClassName?: string; initialFocus?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null> }) {
 // Single overlay ownership: the shared dialog owns the focus trap, Esc,
 // and trigger restoration. The root stays mounted through a controlled
 // closing so Base UI can retain and animate the exiting popup before
 // unmounting; content freezes at close-start so the exit never plays on
 // emptied state, and reopening during the exit cancels the stale
 // unmount. No independent close timer runs alongside it. The topmost
 // guard keeps one Escape from dismissing two sibling overlays (e.g. the
 // inspector above local context).
 const topmost = useTopmostOverlay(open)
 const [visible, setVisible] = useState(open)
 const content = useRef({ title, titleBadge, children, footer })
 // Adjust state during render (not in an effect): reopening shows at
 // once with fresh content, and the exit keeps playing on the frozen
 // close-start content instead of emptied state. The ref below is
 // written before it is read in the same commit and never leaves this
 // component, so the render-phase access is idempotent and StrictMode
 // safe (same exemption shape as the exhaustive-deps disables elsewhere).
 if (open) {
 // eslint-disable-next-line react-hooks/refs
 content.current = { title, titleBadge, children, footer }
 if (!visible) setVisible(true)
 }
 useEffect(() => {
 if (open || !visible) return
 const timer = window.setTimeout(() => setVisible(false), prefersReducedMotion() ? 0 : EXIT_MS)
 return () => window.clearTimeout(timer)
 }, [open, visible])
 // eslint-disable-next-line react-hooks/refs -- frozen at close-start above
 const shown = open ? { title, titleBadge, children, footer } : content.current
 if (!visible) return null
 return (
 <DialogRoot open={open} onOpenChange={(next) => { if (!next) topmost.guard(onClose) }}>
 <DialogPopup side={side} {...(initialFocus ? { initialFocus } : {})} className={popupClassName ?? (side ? undefined : size === 'large' ? 'w-[min(92vw,880px)] max-w-220' : size === 'small' ? 'w-[min(92vw,480px)] max-w-120' : 'w-[min(92vw,720px)] max-w-2xl')}>
 <DialogHeader>
 <div className="flex min-w-0 flex-1 items-center gap-2">
 <DialogTitle>{shown.title}</DialogTitle>
 {shown.titleBadge}
 </div>
 <DialogClose aria-label={`Close ${shown.title}`} />
 </DialogHeader>
 <DialogBody>{shown.children}</DialogBody>
 {shown.footer ? <DialogFooter>{shown.footer}</DialogFooter> : null}
 </DialogPopup>
 </DialogRoot>
 )
}
export function ResourceNotice({ resource, label, hideTitle, skeleton }: { resource: Resource<unknown>; label: string; hideTitle?: boolean; skeleton?: ReactNode }) {
 // Single ownership: every async resource renders through the shared
 // ResourceState. Copy and roles are preserved exactly.
 return <ResourceState resource={resource} label={label} hideTitle={hideTitle} skeleton={skeleton} />
}
