import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CreateSectorDialog } from '@/components/CreateSectorDialog'

function renderDialog(overrides: Partial<React.ComponentProps<typeof CreateSectorDialog>> = {}) {
  return render(
    <CreateSectorDialog creating={false} createError={null} onCreate={() => {}} {...overrides} />,
  )
}

describe('CreateSectorDialog', () => {
  it('creates a sector with a trimmed name and topic', () => {
    const onCreate = vi.fn()
    renderDialog({ onCreate })
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    expect(screen.getByRole('dialog', { name: 'New sector' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Speciality foods  ' } })
    fireEvent.change(screen.getByLabelText('Topic (optional)'), { target: { value: 'Artisanal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sector' }))
    expect(onCreate).toHaveBeenCalledWith('Speciality foods', 'Artisanal')
  })

  it('autofocuses the name field and shows helpers', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'New sector' }))
    const name = await screen.findByLabelText('Name')
    await waitFor(() => expect(name).toHaveFocus())
    expect(screen.getByText('e.g. Australian electrical contractors')).toBeInTheDocument()
    expect(screen.getByText('Narrows what counts as a match.')).toBeInTheDocument()
  })

  it('requires a name before creating', () => {
    const onCreate = vi.fn()
    renderDialog({ onCreate })
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create sector' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Name the sector first.')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Name').getAttribute('aria-describedby')).toContain(alert.id)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('surfaces a failed create instead of staying silent', () => {
    renderDialog({ createError: 'request failed: POST /v1/sectors' })
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    expect(screen.getByRole('alert')).toHaveTextContent('request failed: POST /v1/sectors')
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'New sector' }))
    expect(screen.getByRole('dialog', { name: 'New sector' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New sector' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'New sector' })).toHaveFocus()
  })

  it('cannot close while pending and closes on success', () => {
    const onCreate = vi.fn()
    const { rerender } = renderDialog({ onCreate })
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Speciality foods' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sector' }))
    rerender(<CreateSectorDialog creating createError={null} onCreate={onCreate} />)
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New sector' }), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'New sector' })).toBeInTheDocument()
    rerender(<CreateSectorDialog creating={false} createError={null} onCreate={onCreate} />)
    expect(screen.queryByRole('dialog', { name: 'New sector' })).not.toBeInTheDocument()
  })

  it('keeps the draft when creation fails', () => {
    const { rerender } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Speciality foods' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sector' }))
    rerender(<CreateSectorDialog creating createError={null} onCreate={() => {}} />)
    rerender(<CreateSectorDialog creating={false} createError="boom" onCreate={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New sector' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Speciality foods')
  })

  it('supports a controlled triggerless instance owned by the shell', () => {
    const onOpenChange = vi.fn()
    const { rerender } = renderDialog({ open: false, onOpenChange, trigger: false })
    expect(screen.queryByRole('button', { name: 'New sector' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'New sector' })).not.toBeInTheDocument()
    rerender(
      <CreateSectorDialog
        creating={false}
        createError={null}
        onCreate={() => {}}
        open
        onOpenChange={onOpenChange}
        trigger={false}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'New sector' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
