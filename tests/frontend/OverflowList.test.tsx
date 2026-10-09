import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverflowList } from '@/components/research-parts'

describe('OverflowList', () => {
  it('renders plain rows with no chip at small counts', () => {
    const { container } = render(
      <OverflowList total={3}>
        <li>one</li>
        <li>two</li>
      </OverflowList>,
    )
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/3.*total/)
  })

  it('caps past the threshold behind a truthful total chip', () => {
    const { container } = render(
      <OverflowList total={60}>
        <li>one</li>
        <li>two</li>
      </OverflowList>,
    )
    expect(container).toHaveTextContent(/60.*total/)
    expect(screen.getByText('one')).toBeInTheDocument()
  })
})
