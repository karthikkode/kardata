import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { activateNeighbor } from '@/components/SectorWorkspace'

const VALUES = ['chat', 'plan']

function Harness({ onActivate }: { onActivate: (value: string) => void }) {
  const [current, setCurrent] = useState('chat')
  return (
    <div
      role="tablist"
      aria-label="Research views"
      onKeyDown={(event) =>
        activateNeighbor(event, VALUES, current, (value) => {
          setCurrent(value)
          onActivate(value)
        }, 'research-views')
      }
    >
      {VALUES.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          data-tab-scope="research-views"
          data-tab-value={value}
          aria-selected={current === value}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

describe('workspace tablist keyboard support', () => {
  it('moves selection with arrow keys and Home/End', () => {
    const onActivate = vi.fn()
    render(<Harness onActivate={onActivate} />)
    const tablist = screen.getByRole('tablist', { name: 'Research views' })
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenLastCalledWith('plan')
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(onActivate).toHaveBeenLastCalledWith('chat')
    fireEvent.keyDown(tablist, { key: 'End' })
    expect(onActivate).toHaveBeenLastCalledWith('plan')
    fireEvent.keyDown(tablist, { key: 'Home' })
    expect(onActivate).toHaveBeenLastCalledWith('chat')
  })

  it('ignores unrelated keys', () => {
    const onActivate = vi.fn()
    render(<Harness onActivate={onActivate} />)
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Research views' }), { key: 'Enter' })
    expect(onActivate).not.toHaveBeenCalled()
  })
})
