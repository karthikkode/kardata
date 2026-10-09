// Small formatting helpers shared by feature code.

/** Humanize one data key: snake_case and camelCase become sentence case,
 * with known acronyms uppercased. Unknown keys fall back to this. */
const HUMANIZE_ACRONYMS = new Set(['id', 'url', 'pdf', 'csv', 'json', 'ocr', 'api', 'ip', 'ui', 'db'])
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
  const acronyms = HUMANIZE_ACRONYMS
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (acronyms.has(lower)) return lower.toUpperCase()
      if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1)
      return lower
    })
    .join(' ')
}

/** Relative age ("2h ago") with the full date available via title upstream. */
export function relativeAge(at: string, now: number = Date.now()): string {
  const then = new Date(at).getTime()
  if (!Number.isFinite(then)) return 'Unknown'
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/** Full timestamp ("3 Sep 2026, 14:05") for tooltips and meta lines. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatFullDate(at: string): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  const day = date.getDate()
  const month = MONTH_NAMES[date.getMonth()]
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${year}, ${hours}:${minutes}`
}

/** Short calendar date ("3 Sep 2026") for meta lines. */
export function formatShortDate(at: string): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`
}

/** Active-time duration ("3h 12m") from milliseconds. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'Unknown'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'Under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/** Grouped thousands ("2,005"). */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-AU').format(value)
}
