import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

// Hermetic default: a local frontend/.env (live-mode demo config) must
// never flip the suite to the staging path. Staging tests opt back in
// explicitly with vi.stubEnv in their own beforeEach.
vi.stubEnv('VITE_STAGING_API', '0')
vi.stubEnv('VITE_STAGING_URL', '')
vi.stubEnv('VITE_STAGING_KEY', '')

afterEach(() => {
  cleanup()
  // View state lives in the URL now: reset it so navigation in one test
  // never leaks into the next.
  window.history.replaceState({}, '', '/')
})

// jsdom has no PointerEvent; Base UI pointer handling constructs one.
// Mirror the browser with a MouseEvent-backed stand-in so pointer-driven
// primitives (checkbox and friends) behave under user-event.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = window.MouseEvent as unknown as typeof window.PointerEvent
}
