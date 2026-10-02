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

// jsdom has no ResizeObserver; cmdk measures its list at mount. A no-op
// stand-in is enough: tests never assert on measured sizes.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof window.ResizeObserver
}

// jsdom has no scrollIntoView; cmdk scrolls the active option. A no-op
// stand-in is enough: tests never assert on scroll position.
if (typeof window.HTMLElement !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {}
}

// jsdom's scrollTo/scrollBy/scroll throw "Not implemented"; assistant-ui
// autoscroll calls them inside requestAnimationFrame, where the throw
// escapes as an uncaught exception and fails the whole run flakily.
if (typeof window !== 'undefined') {
  window.scrollTo = function scrollTo(): void {}
  window.scrollBy = function scrollBy(): void {}
  window.scroll = function scroll(): void {}
}
if (typeof window.HTMLElement !== 'undefined') {
  const proto = window.HTMLElement.prototype as HTMLElement & {
    scrollTo?: () => void
    scrollBy?: () => void
  }
  if (!proto.scrollTo) proto.scrollTo = function scrollTo(): void {}
  if (!proto.scrollBy) proto.scrollBy = function scrollBy(): void {}
}
