// First-mount number animation for stat tiles: previous value counts up
// to the final over 240ms. Polls and refetches swap instantly (the
// animation plays once per mount, never on updates). Reduced motion
// shows the final value immediately.
import { useEffect, useRef, type RefObject } from 'react'
import { animate, useReducedMotion } from 'motion/react'
import { MOTION } from './motion'
import { formatCount } from './format'

export function useAnimatedNumber(ref: RefObject<HTMLElement | null>, value: number): void {
  const reduceMotion = useReducedMotion()
  const played = useRef(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (reduceMotion || played.current) {
      node.textContent = formatCount(value)
      return
    }
    played.current = true
    const controls = animate(0, value, {
      duration: MOTION.slow / 1000,
      ease: MOTION.easeSoft,
      onUpdate(latest) {
        node.textContent = formatCount(Math.round(latest))
      },
    })
    return () => {
      controls.stop()
      // StrictMode remounts replay the entrance; real updates stay instant.
      played.current = false
    }
  }, [ref, value, reduceMotion])
}
