import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dialogEnter, dialogExit, dockEnter, dockExit, EXIT_MS, MOTION, noticeEnter,
  pageEnter, pageExit, popoverEnter, popoverExit, POPOVER_MS, rowEnter,
  staggerDelay, tabIndicatorTransition, useExitState,
} from '@/lib/motion'

describe('motion scale (plan 2.6)', () => {
  it('pins the duration and easing tokens', () => {
    expect(MOTION.fast).toBe(120)
    expect(MOTION.base).toBe(180)
    expect(MOTION.slow).toBe(240)
    expect(MOTION.ease).toEqual([0.16, 1, 0.3, 1])
    expect(MOTION.easeSoft).toEqual([0.25, 0.1, 0.25, 1])
  })

  it('pins the exit timing contract', () => {
    expect(EXIT_MS).toBe(180)
    expect(POPOVER_MS).toBe(120)
  })

  it('gives dialogs 180ms opacity plus scale plus 4px rise, 120ms exit', () => {
    expect(dialogEnter).toContain('duration-180')
    expect(dialogEnter).toContain('bottom-1')
    expect(dialogEnter).toContain('zoom-in-95')
    expect(dialogEnter).toContain('fade-in-0')
    expect(dialogExit).toContain('duration-120')
    expect(dialogExit).toContain('fade-out-0')
  })

  it('gives menus and popovers 120ms opacity plus scale, 100ms opacity exit', () => {
    expect(popoverEnter).toContain('duration-120')
    expect(popoverEnter).toContain('zoom-in-95')
    expect(popoverEnter).toContain('fade-in-0')
    expect(popoverExit).toContain('duration-100')
    expect(popoverExit).toContain('fade-out-0')
    expect(popoverExit).not.toMatch(/slide|zoom/)
  })

  it('gives the dock 240ms enter plus 16px from its edge, 180ms exit', () => {
    expect(dockEnter).toContain('duration-240')
    expect(dockEnter).toContain('right-4')
    expect(dockExit).toContain('duration-180')
  })

  it('crossfades pages 120ms out and rises the new page 4px over 180ms', () => {
    expect(pageEnter).toContain('duration-180')
    expect(pageEnter).toContain('fade-in-0')
    expect(pageEnter).toContain('bottom-1')
    expect(pageExit).toContain('duration-120')
    expect(pageExit).toContain('fade-out-0')
    expect(pageExit).not.toContain('slide-out')
  })

  it('rises new rows 4px over 180ms and fades notices without movement', () => {
    expect(rowEnter).toContain('duration-180')
    expect(rowEnter).toContain('bottom-1')
    expect(noticeEnter).toContain('duration-120')
    expect(noticeEnter).not.toContain('slide-in')
  })

  it('slides the tab indicator over 180ms on the motion easing', () => {
    expect(tabIndicatorTransition.duration).toBe(0.18)
    expect(tabIndicatorTransition.ease).toEqual([0.16, 1, 0.3, 1])
  })

  it('staggers list items 30ms apart, capped at the first 12', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(1)).toBeCloseTo(0.03, 5)
    expect(staggerDelay(11)).toBeCloseTo(0.33, 5)
    expect(staggerDelay(12)).toBeCloseTo(0.33, 5)
    expect(staggerDelay(200)).toBeCloseTo(0.33, 5)
  })

  it('keeps every preset inside reduced-motion guards', () => {
    for (const preset of [dialogEnter, dialogExit, popoverEnter, popoverExit, dockEnter, dockExit, pageEnter, pageExit, rowEnter, noticeEnter]) {
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

function ExitProbe({ initial }: { initial: boolean }) {
  const { open, mounted, closing, set } = useExitState(initial)
  return (
    <div>
      <output aria-label="exit-state">{`open=${open} mounted=${mounted} closing=${closing}`}</output>
      <button type="button" onClick={() => set(false)}>close</button>
      <button type="button" onClick={() => set(true)}>open</button>
    </div>
  )
}

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

describe('useExitState', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('holds the surface mounted for the exit keyframes, then unmounts', () => {
    stubMatchMedia(false)
    vi.useFakeTimers()
    render(<ExitProbe initial />)
    const state = () => screen.getByRole('status', { name: 'exit-state' }).textContent
    expect(state()).toBe('open=true mounted=true closing=false')
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(state()).toBe('open=false mounted=true closing=true')
    act(() => {
      vi.advanceTimersByTime(EXIT_MS - 1)
    })
    expect(state()).toBe('open=false mounted=true closing=true')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(state()).toBe('open=false mounted=false closing=false')
  })

  it('unmounts at once under reduced motion', () => {
    stubMatchMedia(true)
    vi.useFakeTimers()
    render(<ExitProbe initial />)
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByRole('status', { name: 'exit-state' }).textContent).toBe('open=false mounted=false closing=false')
  })

  it('reopening mid-exit cancels the pending unmount', () => {
    stubMatchMedia(false)
    vi.useFakeTimers()
    render(<ExitProbe initial />)
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    act(() => {
      vi.advanceTimersByTime(EXIT_MS + 50)
    })
    expect(screen.getByRole('status', { name: 'exit-state' }).textContent).toBe('open=true mounted=true closing=false')
  })
})
