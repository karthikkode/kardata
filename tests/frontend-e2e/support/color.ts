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

function gammaEncode(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear))
  return Math.round(255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055))
}

function oklabToRgb(l: number, a: number, b: number, alpha: number): Rgb | null {
  if (![l, a, b, alpha].every(Number.isFinite)) return null
  const lms1 = l + 0.3963377774 * a + 0.2158037573 * b
  const lms2 = l - 0.1055613458 * a - 0.0638541728 * b
  const lms3 = l - 0.0894841775 * a - 1.2914855480 * b
  const r = 4.0767416621 * lms1 ** 3 - 3.3077115913 * lms2 ** 3 + 0.2309699292 * lms3 ** 3
  const g = -1.2684380046 * lms1 ** 3 + 2.6097574011 * lms2 ** 3 - 0.3413193965 * lms3 ** 3
  const bl = -0.0041960863 * lms1 ** 3 - 0.7034186147 * lms2 ** 3 + 1.7076147010 * lms3 ** 3
  return { r: gammaEncode(r), g: gammaEncode(g), b: gammaEncode(bl), alpha }
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1
  return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
}

/** Parse `oklch(L C H [/ A])` computed-style strings (how Chromium
 * serializes our token colours). Out-of-gamut channels clip the way the
 * browser clips them. Returns null when unparsable. */
export function parseOklch(value: string): Rgb | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?)\s*)?\)$/.exec(value.trim())
  if (!match) return null
  const [, l, c, h, alphaRaw] = match as unknown as [string, string, string, string, string?]
  const lightness = Number(l)
  const chroma = Number(c)
  const hue = (Number(h) * Math.PI) / 180
  return oklabToRgb(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue), parseAlpha(alphaRaw))
}

/** Parse `oklab(L a b [/ A])` computed-style strings (how Chromium
 * serializes colours that passed through color-mix). */
export function parseOklab(value: string): Rgb | null {
  const match = /^oklab\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+%?)\s*)?\)$/.exec(value.trim())
  if (!match) return null
  const [, l, a, b, alphaRaw] = match as unknown as [string, string, string, string, string?]
  return oklabToRgb(Number(l), Number(a), Number(b), parseAlpha(alphaRaw))
}

/** Parse any computed-style colour the audit accepts. Unknown formats
 * (color-mix, lab, color()) return null so callers fail loud. */
export function parseCssColor(value: string): Rgb | null {
  return parseRgb(value) ?? parseOklch(value) ?? parseOklab(value)
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
