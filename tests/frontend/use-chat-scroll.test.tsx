// [F:frontend.src.components.chat.useChatScroll]
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useChatScroll } from '@/components/chat/useChatScroll'

function mockLog(scrollHeight: number, clientHeight: number, scrollTop: number): HTMLDivElement {
  const div = document.createElement('div')
  Object.defineProperties(div, {
    scrollHeight: { value: scrollHeight, configurable: true },
    clientHeight: { value: clientHeight, configurable: true },
  })
  div.scrollTop = scrollTop
  return div
}

describe('chat scroll stick', () => {
  it('parks and releases the Latest escape on scroll', () => {
    const { result } = renderHook(() => useChatScroll({ messages: [], pendingText: null, pendingTools: [], working: false }))
    act(() => {
      result.current.logRef.current = mockLog(1000, 200, 0)
    })
    act(() => {
      result.current.onLogScroll()
    })
    expect(result.current.showLatest).toBe(true)
    act(() => {
      result.current.logRef.current = mockLog(1000, 200, 800)
    })
    act(() => {
      result.current.onLogScroll()
    })
    expect(result.current.showLatest).toBe(false)
  })

  it('sticks to the bottom and resets the escape', () => {
    const { result } = renderHook(() => useChatScroll({ messages: [], pendingText: null, pendingTools: [], working: false }))
    const div = mockLog(1000, 200, 0)
    act(() => {
      result.current.logRef.current = div
    })
    act(() => {
      result.current.stickToBottom()
    })
    expect(div.scrollTop).toBe(1000)
    act(() => {
      result.current.onLogScroll()
    })
    expect(result.current.showLatest).toBe(false)
    act(() => {
      result.current.resetScroll()
    })
    expect(result.current.showLatest).toBe(false)
  })
})
