import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from '@/components/chat/Composer'

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onChange = vi.fn()
  const view = render(
    <Composer
      id="composer"
      label="Message this conversation"
      value=""
      onChange={onChange}
      placeholder="Message..."
      {...overrides}
    />,
  )
  return { onChange, ...view }
}

describe('Composer', () => {
  it('renders the labeled textarea with its placeholder', () => {
    renderComposer({ value: 'hello' })
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    expect(box).toHaveValue('hello')
    expect(box).toHaveAttribute('placeholder', 'Message...')
    expect(box).toHaveAttribute('rows', '1')
  })

  it('forwards typing and key handling to the caller', async () => {
    const onKeyDown = vi.fn()
    const { onChange } = renderComposer({ onKeyDown })
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    await userEvent.type(box, 'hi')
    expect(onChange).toHaveBeenCalledWith('h')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onKeyDown).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'Enter' }))
  })

  it('grows with content and clamps at eight lines', () => {
    const { rerender } = renderComposer({ value: 'one line' })
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 100 })
    rerender(
      <Composer id="composer" label="Message this conversation" value="one line plus more" onChange={() => undefined} placeholder="Message..." />,
    )
    expect(box.style.height).toBe('100px')
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 400 })
    rerender(
      <Composer id="composer" label="Message this conversation" value="far more lines than fit" onChange={() => undefined} placeholder="Message..." />,
    )
    expect(box.style.height).toBe('176px')
  })

  it('reserves the shortcut hint space so blur never shifts the send button', async () => {
    renderComposer()
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    // Present but invisible before focus: unmounting on blur used to move
    // the send button between mousedown and mouseup, swallowing the click.
    const hint = screen.getByText('to send,').closest('p') as HTMLElement
    expect(hint).toHaveAttribute('aria-hidden', 'true')
    expect(hint.className).toContain('invisible')
    fireEvent.focus(box)
    expect(screen.getByText('to send,').closest('p')).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByText('to send,').closest('p')?.className).not.toContain('invisible')
    expect(screen.getAllByText('Enter')).toHaveLength(2)
    fireEvent.blur(box)
    expect(screen.getByText('to send,').closest('p')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows the failure notice with the detail and a working Retry', () => {
    const onRetry = vi.fn()
    renderComposer({ error: 'No connection. Try again.', onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('That did not go through.')
    expect(screen.getByRole('alert')).toHaveTextContent('No connection. Try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders toolbar slots on one row', () => {
    renderComposer({ left: <button type="button">Left</button>, right: <button type="button">Right</button> })
    expect(screen.getByRole('button', { name: 'Left' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Right' })).toBeInTheDocument()
  })

  it('disables the textarea and dims the card when denied', () => {
    const { container } = renderComposer({ disabled: true })
    expect(screen.getByRole('textbox', { name: 'Message this conversation' })).toBeDisabled()
    expect(container.firstElementChild?.firstElementChild?.className).toContain('opacity-60')
  })
})
