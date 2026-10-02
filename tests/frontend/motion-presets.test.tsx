import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { dialogEnter, dialogExit, dockEnter, EXIT_MS, noticeEnter, pageEnter, popoverEnter, popoverExit, POPOVER_MS, rowEnter } from '@/lib/motion'

describe('motion presets (handoff 2.7)', () => {
  it('pins the exit timing contract', () => {
    expect(EXIT_MS).toBe(200)
    expect(POPOVER_MS).toBe(150)
  })

  it('gives dialogs 200ms opacity plus 8px rise', () => {
    expect(dialogEnter).toContain('duration-200')
    expect(dialogEnter).toContain('bottom-2')
    expect(dialogEnter).toContain('fade-in-0')
    expect(dialogExit).toContain('duration-200')
  })

  it('gives menus and popovers 150ms opacity plus 4px rise', () => {
    expect(popoverEnter).toContain('duration-150')
    expect(popoverEnter).toContain('bottom-1')
    expect(popoverEnter).toContain('fade-in-0')
    expect(popoverExit).toContain('duration-150')
  })

  it('gives the dock 200ms opacity plus 16px from its edge', () => {
    expect(dockEnter).toContain('duration-200')
    expect(dockEnter).toContain('right-4')
  })

  it('crossfades pages over 200ms with opacity only', () => {
    expect(pageEnter).toContain('duration-200')
    expect(pageEnter).toContain('fade-in-0')
    expect(pageEnter).not.toContain('slide-in')
  })

  it('rises new rows 4px over 150ms and fades notices without movement', () => {
    expect(rowEnter).toContain('duration-150')
    expect(rowEnter).toContain('bottom-1')
    expect(noticeEnter).toContain('duration-150')
    expect(noticeEnter).not.toContain('slide-in')
  })

  it('keeps every preset inside reduced-motion guards', () => {
    for (const preset of [dialogEnter, popoverEnter, dockEnter, pageEnter, rowEnter, noticeEnter]) {
      expect(preset).toContain('motion-safe:')
    }
  })

  it('renders without animation classes leaking into static markup', () => {
    render(<div className={pageEnter}>section</div>)
    expect(screen.getByText('section')).toBeInTheDocument()
  })
})

describe('motion ownership', () => {
  it('rejects springs and layout-animating presets', async () => {
    const motion = await import('@/lib/motion')
    const source = Object.values(motion)
      .filter((value) => typeof value === 'string')
      .join(' ')
    expect(source).not.toMatch(/spring|parallax|drag|scroll-linked|counter/i)
  })
})
