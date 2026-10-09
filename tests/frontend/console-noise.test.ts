// C1a: console-noise predicates for the failures runner and the faulted
// matrix states. Newer Chromium logs resource errors without any URL
// ("Failed to load resource: the server responded with a status of 500
// ..."), so the scope filter cannot attribute them; the runner drops
// them only when the faulted scope actually served that status.
import type { ConsoleMessage } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { isFaultedResourceNoise, unattributedNoiseStatus } from '../frontend-e2e/support/matrix'

function msg(text: string, url = '', type = 'error'): ConsoleMessage {
  return {
    type: () => type,
    text: () => text,
    location: () => ({ url, lineNumber: 0, columnNumber: 0 }),
  } as unknown as ConsoleMessage
}

const SCOPE = /\/v1\/providers/

describe('isFaultedResourceNoise', () => {
  it('matches the location URL', () => {
    expect(isFaultedResourceNoise(msg('Failed to load resource: x', 'http://127.0.0.1:15174/v1/providers'), SCOPE)).toBe(true)
  })
  it('matches a URL embedded in the text', () => {
    expect(
      isFaultedResourceNoise(msg('Failed to load resource: http://127.0.0.1:15174/v1/providers 500', ''), SCOPE),
    ).toBe(true)
  })
  it('rejects other URLs, non-errors and real console errors', () => {
    expect(isFaultedResourceNoise(msg('Failed to load resource: x', 'http://127.0.0.1:15174/v1/sessions/1'), SCOPE)).toBe(false)
    expect(isFaultedResourceNoise(msg('Failed to load resource: x', 'http://127.0.0.1:15174/v1/providers', 'warning'), SCOPE)).toBe(false)
    expect(isFaultedResourceNoise(msg('TypeError: null is not an object', 'http://127.0.0.1:15174/v1/providers'), SCOPE)).toBe(false)
    expect(isFaultedResourceNoise(msg('Failed to load resource: the server responded with a status of 500 (Internal Server Error)'), SCOPE)).toBe(false)
  })
})

describe('unattributedNoiseStatus', () => {
  it('parses the status of URL-less noise', () => {
    expect(unattributedNoiseStatus(msg('Failed to load resource: the server responded with a status of 500 (Internal Server Error)'))).toBe(500)
    expect(unattributedNoiseStatus(msg('Failed to load resource: the server responded with a status of 404 (Not Found)'))).toBe(404)
  })
  it('returns undefined for attributed messages and non-noise', () => {
    expect(unattributedNoiseStatus(msg('Failed to load resource: x', 'http://127.0.0.1:15174/v1/providers'))).toBeUndefined()
    expect(unattributedNoiseStatus(msg('Failed to load resource: http://127.0.0.1:15174/v1/providers 500', ''))).toBeUndefined()
    expect(unattributedNoiseStatus(msg('TypeError: boom'))).toBeUndefined()
    expect(unattributedNoiseStatus(msg('Failed to load resource: net::ERR_ABORTED'))).toBeUndefined()
    expect(unattributedNoiseStatus(msg('Failed to load resource: x', '', 'warning'))).toBeUndefined()
  })
})
