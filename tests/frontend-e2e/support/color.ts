// Pure colour helpers for the v2 style audit (no imports: safe to load
// in the browser evaluate sandbox and in unit tests).

export interface Rgb { r: number; g: number; b: number; alpha: number }

/** Parse `rgb()` / `rgba()` computed-style strings. Returns null when the
 * value is transparent or unparsable. */
export function parseRgb(value: string): Rgb | null {
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value.trim())
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (!Number.isFinite(alpha)) return null
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), alpha }
}

function linearChannel(value: number): number {
  const c = Math.min(1, Math.max(0, value / 255))
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an opaque sRGB colour. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b)
}

/** WCAG contrast ratio of two opaque colours. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const light = relativeLuminance(foreground)
  const dark = relativeLuminance(background)
  const [hi, lo] = light >= dark ? [light, dark] : [dark, light]
  return (hi + 0.05) / (lo + 0.05)
}
