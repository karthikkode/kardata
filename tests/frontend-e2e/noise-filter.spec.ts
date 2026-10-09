// Filter unit tests (P6-B2): the console filter must drop ONLY Chromium's
// own resource errors for the faulted scope. Pure-logic spec: no browser.
import { expect, test, type ConsoleMessage } from '@playwright/test'
import { isFaultedResourceNoise } from './support/matrix'

function stubMsg(type: string, text: string, url: string): ConsoleMessage {
  return {
    type: () => type,
    text: () => text,
    location: () => ({ url, lineNumber: 0, columnNumber: 0 }),
  } as unknown as ConsoleMessage
}

const FAULTED = /\/v1\/sectors(\?.*)?$/
const STATUS_500 = 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
const OFFLINE = 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED'

test('drops a status resource error for the faulted URL', () => {
  const msg = stubMsg('error', STATUS_500, 'http://localhost:3102/v1/sectors')
  expect(isFaultedResourceNoise(msg, FAULTED)).toBe(true)
})

test('drops an offline resource error for the faulted URL', () => {
  const msg = stubMsg('error', OFFLINE, 'http://localhost:3102/v1/sectors?page=2')
  expect(isFaultedResourceNoise(msg, FAULTED)).toBe(true)
})

test('keeps a resource error for an app chunk outside the scope', () => {
  const msg = stubMsg('error', STATUS_500, 'http://localhost:5174/assets/index-abc.js')
  expect(isFaultedResourceNoise(msg, FAULTED)).toBe(false)
})

test('keeps a resource error for an unfaulted endpoint', () => {
  const msg = stubMsg('error', STATUS_500, 'http://localhost:3102/v1/runs')
  expect(isFaultedResourceNoise(msg, FAULTED)).toBe(false)
})

test('keeps a real app console.error on the faulted URL', () => {
  const msg = stubMsg('error', 'TypeError: Cannot read properties of undefined', 'http://localhost:3102/v1/sectors')
  expect(isFaultedResourceNoise(msg, FAULTED)).toBe(false)
})

test('keeps non-error messages with resource text', () => {
  const msg = stubMsg('warning', STATUS_500, 'http://localhost:3102/v1/sectors')
  expect(isFaultedResourceNoise(msg, FAULTED)).toBe(false)
})
