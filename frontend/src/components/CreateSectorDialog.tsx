// CreateSectorDialog (RS-06): the single "New sector" dialog, rendered
// from the page header on Overview and Researches. Success closes the
// dialog (App toasts and navigates); a failed submit keeps the draft.
import { useEffect, useId, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { Button } from './ui/button'
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './text'

export function CreateSectorDialog({
  creating,
  createError,
  onCreate,
  open: controlledOpen,
  onOpenChange,
  trigger = true,
}: {
  creating: boolean
  createError: string | null
  onCreate: (name: string, topic: string) => void
  /** Controlled open state; omit for the built-in New-sector trigger. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  const baseId = useId()
  const nameId = `${baseId}-name`
  const topicId = `${baseId}-topic`
  const nameHelperId = `${baseId}-name-helper`
  const nameErrorId = `${baseId}-name-error`

  // Success is owned by the caller (toast + navigate there): when the
  // pending round trips back to idle with no error, close and reset.
  const wasCreating = useRef(false)
  useEffect(() => {
    if (wasCreating.current && !creating && !createError && open) {
      setOpen(false)
      setName('')
      setTopic('')
      setError('')
    }
    wasCreating.current = creating
  }, [creating, createError, open])

  // Typed values survive a failed submit: the dialog stays open with the
  // draft intact, and only a successful creation closes it.
  function submit() {
    if (creating) return
    if (!name.trim()) {
      setError('Name the sector first.')
      nameRef.current?.focus()
      return
    }
    setError('')
    onCreate(name.trim(), topic.trim())
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (creating) return
        setOpen(next)
        if (!next) setError('')
      }}
    >
      {trigger ? (
        <DialogTrigger
          render={(props) => (
            <Button type="button" variant="primary" size="sm" {...props}>
              <Icons.plus aria-hidden />
              New sector
            </Button>
          )}
        />
      ) : null}
      <DialogPopup initialFocus={nameRef}>
        <DialogHeader>
          <div className="min-w-0 flex-1">
            <DialogTitle>New sector</DialogTitle>
            <DialogDescription>
              Name the market you want to research. Research starts only after you approve a plan.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form
            aria-label="Create a sector"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label as="label" htmlFor={nameId}>Name</Label>
              <Input
                ref={nameRef}
                id={nameId}
                value={name}
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${nameHelperId} ${nameErrorId}` : nameHelperId}
                onChange={(event) => setName(event.target.value)}
              />
              <p id={nameHelperId} className="text-xs text-foreground-subtle">
                e.g. Australian electrical contractors
              </p>
              {error ? (
                <p id={nameErrorId} role="alert" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label as="label" htmlFor={topicId}>Topic (optional)</Label>
              <Input
                id={topicId}
                value={topic}
                aria-describedby={`${topicId}-helper`}
                onChange={(event) => setTopic(event.target.value)}
              />
              <p id={`${topicId}-helper`} className="text-xs text-foreground-subtle">
                Narrows what counts as a match.
              </p>
            </div>
          </form>
          {!error && createError ? (
            <p role="alert" className="mt-4 text-sm text-danger">
              {createError}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={creating} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={creating} pending={creating} onClick={submit}>
            {creating ? 'Creating…' : 'Create sector'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </DialogRoot>
  )
}
