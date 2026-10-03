import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY, useTheme } from '@/lib/theme'

type MediaListener = (event: { matches: boolean }) => void

let systemDark = false
let listeners: MediaListener[] = []

function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: systemDark,
    media: query,
    addEventListener: (_type: string, listener: MediaListener) => {
      listeners.push(listener)
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      listeners = listeners.filter((entry) => entry !== listener)
    },
  }))
}

function Probe() {
  const { preference, resolved, setPreference } = useTheme()
  return (
    <div>
      <output aria-label="theme">{`${preference}/${resolved}`}</output>
      <button type="button" onClick={() => setPreference('light')}>light</button>
      <button type="button" onClick={() => setPreference('dark')}>dark</button>
      <button type="button" onClick={() => setPreference('system')}>system</button>
    </div>
  )
}

describe('theme preference (F2)', () => {
  beforeEach(() => {
    systemDark = false
    listeners = []
    stubMatchMedia()
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('follows the OS setting by default', () => {
    systemDark = true
    stubMatchMedia()
    render(<Probe />)
    expect(screen.getByRole('status', { name: 'theme' })).toHaveTextContent('system/dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('persists the manual override and applies it immediately', () => {
    systemDark = true
    stubMatchMedia()
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(screen.getByRole('status', { name: 'theme' })).toHaveTextContent('light/light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('reads the stored preference on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(<Probe />)
    expect(screen.getByRole('status', { name: 'theme' })).toHaveTextContent('dark/dark')
  })

  it('reacts to OS changes while the preference is system', () => {
    render(<Probe />)
    expect(screen.getByRole('status', { name: 'theme' })).toHaveTextContent('system/light')
    act(() => {
      systemDark = true
      for (const listener of listeners) listener({ matches: true })
    })
    expect(screen.getByRole('status', { name: 'theme' })).toHaveTextContent('system/dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('ignores OS changes under a manual override', () => {
    render(<Probe />)
    const [stale] = listeners
    expect(stale).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(listeners).toHaveLength(0)
    act(() => {
      stale({ matches: true })
    })
    expect(screen.getByRole('status', { name: 'theme' })).toHaveTextContent('light/light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('resolves the theme before first paint with a blocking head script', () => {
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'frontend', 'index.html'), 'utf8')
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain('kardata-theme')
    expect(head).toContain('prefers-color-scheme')
    expect(head).toMatch(/document\.documentElement\.classList\.add\('dark'\)/)
    // Blocking: no async/defer/src on the theme script, and it runs before the module entry.
    expect(head).not.toMatch(/<script[^>]*\bsrc=.*kardata-theme/)
    expect(html.indexOf('kardata-theme')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
  })
})
