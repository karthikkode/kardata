import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceOverlay } from '@/components/workspace-parts'
import { ConfirmAction } from '@/components/ui/alert-dialog'

function Nested() {
  const [parent, setParent] = useState(true)
  const [child, setChild] = useState(false)
  return (
    <>
      {parent ? (
        <WorkspaceOverlay title="Local context" onClose={() => setParent(false)}>
          <button type="button" onClick={() => setChild(true)}>
            Open inspector
          </button>
        </WorkspaceOverlay>
      ) : null}
      {child ? (
        <WorkspaceOverlay title="Execution records" onClose={() => setChild(false)}>
          <p>record detail</p>
        </WorkspaceOverlay>
      ) : null}
    </>
  )
}

describe('nested overlay Escape', () => {
  it('closes only the topmost sibling overlay, even pressed twice fast', async () => {
    const user = userEvent.setup()
    render(<Nested />)
    await user.click(screen.getByRole('button', { name: 'Open inspector' }))
    expect(screen.getByRole('dialog', { name: 'Execution records' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Execution records' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Local context' })).toBeInTheDocument()
    await user.keyboard('{Escape}{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Local context' })).not.toBeInTheDocument()
  })

describe('overlay lifecycle', () => {
  it('re-registers a permanently mounted confirm on reopen', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Delete conversation
          </button>
          <ConfirmAction
            open={open}
            onOpenChange={setOpen}
            title="Delete conversation?"
            description="Removes the chat."
            confirmLabel="Delete conversation"
            onConfirm={() => undefined}
          />
        </>
      )
    }
    render(<Harness />)
    for (let round = 0; round < 2; round++) {
      await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    }
  })

  it('keeps registration when closure is refused while busy', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(true)
      const [busy, setBusy] = useState(true)
      return (
        <WorkspaceOverlay title="Review candidate intake" open={open} onClose={() => { if (!busy) setOpen(false) }}>
          <p>review content</p>
          {busy ? (
            <button type="button" onClick={() => setBusy(false)}>
              Finish work
            </button>
          ) : null}
        </WorkspaceOverlay>
      )
    }
    render(<Harness />)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Review candidate intake' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish work' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Review candidate intake' })).not.toBeInTheDocument()
  })

  it('keeps the parent dialog behind a confirm action', async () => {
    const user = userEvent.setup()
    const onParent = vi.fn()
    function Harness() {
      const [confirm, setConfirm] = useState(true)
      return (
        <WorkspaceOverlay title="Conversation options" onClose={onParent}>
          <button type="button" onClick={() => setConfirm(true)}>
            Reopen confirm
          </button>
          <ConfirmAction
            open={confirm}
            onOpenChange={setConfirm}
            title="Delete conversation?"
            description="Removes the chat."
            confirmLabel="Delete conversation"
            onConfirm={() => undefined}
          />
        </WorkspaceOverlay>
      )
    }
    render(<Harness />)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Conversation options' })).toBeInTheDocument()
    expect(onParent).not.toHaveBeenCalled()
  })
})

})