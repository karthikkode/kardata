// House markdown for agent replies. Model output is untrusted: raw HTML
// never becomes DOM (skipHtml), only the GFM subset below survives, and
// links are restricted to http(s). Styling maps onto existing text tokens;
// user bubbles and mention chips intentionally stay plain text.
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Compass,
  FileText,
  HelpCircle,
  Search,
  Target,
  Wallet,
} from 'lucide-react'

const ALLOWED_ELEMENTS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'blockquote',
  'a',
  'hr',
]

export function safeExternalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url
  } catch {
    // Fall through to the inert anchor below.
  }
  return '#'
}

/** Plain text of heading children for keyword matching; complex nodes opt out. */
function headingText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(headingText).join('')
  return ''
}

/** Plan glyph by heading keyword with a neutral document fallback, so
 * every brief section, known or custom, gets a medallion. Styling only:
 * nothing is parsed for scope or authority. */
export function planSectionIcon(text: string): typeof Target {
  return headingIcon(text) ?? FileText
}

/** Section glyph by heading keyword (case-insensitive); unknown sections stay plain. */
function headingIcon(text: string): typeof Target | null {
  const needle = text.toLowerCase()
  if (needle.includes('scope')) return Target
  if (needle.includes('direction')) return Compass
  if (needle.includes('quer')) return Search
  if (needle.includes('budget')) return Wallet
  if (needle.includes('risk')) return AlertTriangle
  if (needle.includes('question')) return HelpCircle
  return null
}

const components: Components = {
  p: ({ children }) => <p className="my-1.5 text-sm leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-lg font-semibold tracking-tight first:mt-0 last:mb-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-5 mb-2 text-base font-semibold tracking-tight first:mt-0 last:mb-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-2 text-sm font-semibold first:mt-0 last:mb-0">{children}</h3>,
  h4: ({ children }) => <h4 className="my-1.5 text-xs font-semibold tracking-wide text-muted-foreground first:mt-0 last:mb-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-sm marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-sm marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded border border-border/70 bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="scroll-slim my-3 overflow-x-auto rounded-lg border border-border/70 bg-muted p-3 font-mono text-xs first:mt-0 last:mb-0 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:break-normal">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="scroll-slim my-2 overflow-x-auto rounded-lg border border-border first:mt-0 last:mb-0">
      <table className="w-max min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th scope="col" className="border-b border-border px-3 py-1.5 text-left font-semibold whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border/50 px-3 py-1.5 align-top last:border-0 [overflow-wrap:anywhere]">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 rounded-r-lg border-l-2 border-primary/50 bg-muted/50 px-3 py-1.5 text-sm first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      className="font-medium text-primary underline decoration-primary/40 underline-offset-2 [overflow-wrap:anywhere]"
      href={safeExternalUrl(href ?? '')}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-border" />,
}

export function Markdown({ text, variant = 'chat' }: { text: string; variant?: 'chat' | 'plan' }) {
  // Plan documents render through the explicit plan variant: decorative
  // section glyphs and grouped-row rhythm live on the renderer itself, not
  // on wrapper DOM (no reaching through ancestors). Ordinary chat never
  // receives keyword icons.
  const renderers: Components =
    variant === 'plan'
      ? {
          ...components,
          h2: ({ children }) => {
            const Icon = headingIcon(headingText(children))
            return (
              <h2 className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-base font-semibold tracking-tight first:mt-0 first:border-t-0 first:pt-0">
                {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
                <span className="min-w-0">{children}</span>
              </h2>
            )
          },
          h3: ({ children }) => {
            const Icon = headingIcon(headingText(children))
            return (
              <h3 className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-sm font-semibold first:mt-0 first:border-t-0 first:pt-0">
                {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                <span className="min-w-0">{children}</span>
              </h3>
            )
          },
          p: ({ children }) => <p className="mt-1 mb-0 text-sm leading-relaxed text-muted-foreground first:mt-0">{children}</p>,
        }
      : components
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      skipHtml
      urlTransform={safeExternalUrl}
      components={renderers}
    >
      {text}
    </ReactMarkdown>
    </div>
  )
}
