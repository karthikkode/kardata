// Theme preference: System / Light / Dark, persisted in localStorage.
// Default follows the OS setting; a blocking inline script in index.html
// applies the resolved class before first paint so there is no flash.
import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'kardata-theme'

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage unavailable (private mode): fall through to system.
  }
  return 'system'
}

function systemDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function useTheme(): {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => void
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [systemDarkMode, setSystemDarkMode] = useState<boolean>(systemDark)

  useEffect(() => {
    const dark = preference === 'dark' || (preference === 'system' && systemDarkMode)
    document.documentElement.classList.toggle('dark', dark)
  }, [preference, systemDarkMode])

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent): void => setSystemDarkMode(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
    setPreferenceState(next)
  }, [])

  const resolved: ResolvedTheme =
    preference === 'system' ? (systemDarkMode ? 'dark' : 'light') : preference
  return { preference, resolved, setPreference }
}
