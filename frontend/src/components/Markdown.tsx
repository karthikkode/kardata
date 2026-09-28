// House markdown for agent replies. Model output is untrusted: raw HTML
// never becomes DOM (skipHtml), only the GFM subset below survives, and
// links are restricted to http(s). Styling maps onto existing text tokens;
// user bubbles and mention chips intentionally stay plain text.
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url, 'https://chat.local')
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url
  } catch {
    // Fall through to the inert anchor below.
  }
  return '#'
}

const components: Components = {
  p: ({ children }) => <p className="my-1.5 text-sm leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="my-2 text-base font-semibold tracking-tight first:mt-0 last:mb-0">{children}</h1>,
  h2: ({ children }) => <h2 className="my-2 text-sm font-semibold tracking-tight first:mt-0 last:mb-0">{children}</h2>,
  h3: ({ children }) => <h3 className="my-1.5 text-sm font-semibold first:mt-0 last:mb-0">{children}</h3>,
  h4: ({ children }) => <h4 className="my-1.5 text-xs font-semibold tracking-wide text-muted-foreground first:mt-0 last:mb-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-sm marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-sm marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded border border-border/70 bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="scroll-slim my-2 overflow-x-auto rounded-lg border border-border/70 bg-muted p-2.5 font-mono text-xs first:mt-0 last:mb-0">{children}</pre>
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
      href={safeUrl(href ?? '')}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-border" />,
}

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      skipHtml
      urlTransform={safeUrl}
      components={components}
    >
      {text}
    </ReactMarkdown>
  )
}
