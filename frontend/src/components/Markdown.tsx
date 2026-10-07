// House markdown for agent replies. Model output is untrusted: raw HTML
// never becomes DOM (skipHtml), only the GFM subset below survives, and
// links are restricted to http(s). Styling maps onto existing text tokens;
// user bubbles and mention chips intentionally stay plain text.
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isValidElement, memo, type ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { notify } from '../lib/toast'
import { IconButton } from './IconButton'

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
export function planSectionIcon(text: string): typeof Icons.target {
 return headingIcon(text) ?? Icons.fileDocs
}

/** Section glyph by heading keyword (case-insensitive); unknown sections stay plain. */
function headingIcon(text: string): typeof Icons.target | null {
 const needle = text.toLowerCase()
 if (needle.includes('scope')) return Icons.target
 if (needle.includes('direction')) return Icons.steer
 if (needle.includes('quer')) return Icons.search
 if (needle.includes('budget')) return Icons.budget
 if (needle.includes('risk')) return Icons.alertWarning
 if (needle.includes('question')) return Icons.help
 return null
}

/** Fenced code block with a copy action (CV-03). */
function CodeBlock({ children }: { children: ReactNode }) {
 function textOf(node: ReactNode): string {
 if (typeof node === 'string' || typeof node === 'number') return String(node)
 if (Array.isArray(node)) return node.map(textOf).join('')
 // Fenced blocks arrive as a <code> element wrapping the source text.
 if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
 return ''
 }
 async function copy(): Promise<void> {
 try {
 await navigator.clipboard.writeText(textOf(children))
 notify.success('Copied')
 } catch {
 notify.error('Copy failed. Try again.')
 }
 }
 return (
 <div className="relative my-3 first:mt-0 last:mb-0">
 <pre aria-label="Code block" tabIndex={0} className="scroll-slim overflow-x-auto rounded-lg bg-surface-sunken p-3 pr-11 font-mono text-[13px] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_code]:bg-transparent [&_code]:p-0 [&_code]:break-normal">{children}</pre>
 <IconButton label="Copy code" size="icon-sm" onClick={() => void copy()} className="absolute top-2 right-2">
 <Icons.copy className="size-4" aria-hidden />
 </IconButton>
 </div>
 )
}

const components: Components = {
 p: ({ children }) => <p className="my-1.5 text-sm leading-[22px] first:mt-0 last:mb-0">{children}</p>,
 strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
 h1: ({ children }) => <h1 className="mt-4 mb-1 text-[15px] leading-[22px] font-medium first:mt-0">{children}</h1>,
 h2: ({ children }) => <h2 className="mt-4 mb-1 text-[15px] leading-[22px] font-medium first:mt-0">{children}</h2>,
 h3: ({ children }) => <h3 className="mt-4 mb-1 text-sm leading-[22px] font-medium first:mt-0">{children}</h3>,
 h4: ({ children }) => <h4 className="mt-4 mb-1 text-sm leading-[22px] font-medium first:mt-0">{children}</h4>,
 ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-sm leading-[22px] marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ul>,
 ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-sm leading-[22px] marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ol>,
 li: ({ children }) => <li className="pl-0.5">{children}</li>,
 code: ({ children }) => (
 <code className="rounded-sm bg-surface-sunken px-1 font-mono text-[13px] break-all">{children}</code>
 ),
 pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
 table: ({ children }) => (
 <div tabIndex={0} aria-label="Table" className="scroll-slim my-2 overflow-x-auto rounded-lg border border-border first:mt-0 last:mb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
 <table className="w-max min-w-full border-collapse text-ui">{children}</table>
 </div>
 ),
 thead: ({ children }) => <thead className="bg-surface-sunken">{children}</thead>,
 th: ({ children }) => (
 <th scope="col" className="border-b border-border px-3 py-1.5 text-left text-[13px] font-medium whitespace-nowrap">{children}</th>
 ),
 td: ({ children }) => <td className="border-b border-border-subtle px-3 py-1.5 align-top text-[13px] last:border-0 [overflow-wrap:anywhere]">{children}</td>,
 blockquote: ({ children }) => (
 <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-sm leading-[22px] text-muted-foreground first:mt-0 last:mb-0">
 {children}
 </blockquote>
 ),
 a: ({ children, href }) => (
 <a
 className="text-primary-text underline-offset-4 hover:underline [overflow-wrap:anywhere]"
 href={safeExternalUrl(href ?? '')}
 target="_blank"
 rel="noreferrer"
 >
 {children}
 </a>
 ),
 hr: () => <hr className="my-2 border-border" />,
}

/** Plain-text fast path: remark re-parse per mount costs ~150ms for a
 * 50-segment tail (measured on session switch). Texts with no markdown
 * syntax and no GFM autolinkables render byte-identical paragraphs
 * without the unified pipeline. Conservative: anything doubtful falls
 * through to ReactMarkdown. Bare parens, dots, quotes and mid-line > are
 * literal in GFM and stay fast; < (skipped HTML), escapes, and email
 * autolinks always take the slow path. */
const MARKDOWN_SYNTAX =
 /[`*_#|[\]{}!\\<~]|^\s*[-+>]|^\s*\d+[.)]|https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/m
export function isPlainChatText(text: string): boolean {
 return text.length <= 5000 && !MARKDOWN_SYNTAX.test(text)
}

const compactComponents: Components = {
 ...components,
 h1: ({ children }) => <h1 className="mt-3 mb-1 text-ui leading-5 font-medium first:mt-0">{children}</h1>,
 h2: ({ children }) => <h2 className="mt-3 mb-1 text-ui leading-5 font-medium first:mt-0">{children}</h2>,
 h3: ({ children }) => <h3 className="mt-3 mb-1 text-ui leading-5 font-medium first:mt-0">{children}</h3>,
 h4: ({ children }) => <h4 className="mt-3 mb-1 text-ui leading-5 font-medium first:mt-0">{children}</h4>,
 p: ({ children }) => <p className="my-1 text-ui leading-5 text-muted-foreground first:mt-0 last:mb-0">{children}</p>,
 ul: ({ children }) => <ul className="my-1 list-disc space-y-1 pl-5 text-ui leading-5 text-muted-foreground marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ul>,
 ol: ({ children }) => <ol className="my-1 list-decimal space-y-1 pl-5 text-ui leading-5 text-muted-foreground marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ol>,
 blockquote: ({ children }) => (
 <blockquote className="my-1 border-l-2 border-border-strong pl-3 text-ui leading-5 text-muted-foreground first:mt-0 last:mb-0">
 {children}
 </blockquote>
 ),
}

/** Label-register headings for prose inside Overline-labelled context
 * sections: an in-section `## Coverage` reads as a sub-label and can
 * never look larger or bolder than the section labels above it. Body
 * prose stays compact. */
const sectionComponents: Components = {
 ...compactComponents,
 h1: ({ children }) => <h1 className="mt-3 mb-1 text-2xs font-medium tracking-[0.05em] text-foreground-subtle uppercase first:mt-0">{children}</h1>,
 h2: ({ children }) => <h2 className="mt-3 mb-1 text-2xs font-medium tracking-[0.05em] text-foreground-subtle uppercase first:mt-0">{children}</h2>,
 h3: ({ children }) => <h3 className="mt-3 mb-1 text-2xs font-medium tracking-[0.05em] text-foreground-subtle uppercase first:mt-0">{children}</h3>,
 h4: ({ children }) => <h4 className="mt-3 mb-1 text-2xs font-medium tracking-[0.05em] text-foreground-subtle uppercase first:mt-0">{children}</h4>,
}

const planComponents: Components = {
 ...components,
 h2: ({ children }) => {
 const Icon = headingIcon(headingText(children))
 return (
 <h2 className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-base font-semibold first:mt-0 first:border-t-0 first:pt-0">
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

function MarkdownView({ text, variant = 'chat' }: { text: string; variant?: 'chat' | 'plan' | 'compact' | 'section' }) {
 // Plan documents render through the explicit plan variant: decorative
 // section glyphs and grouped-row rhythm live on the renderer itself, not
 // on wrapper DOM (no reaching through ancestors). Ordinary chat never
 // receives keyword icons. The compact variant is 13px rails-and-brief
 // prose: every heading 13/20 500, paragraphs 13/20 muted. The section
 // variant shares compact prose but drops headings into the Overline
 // label register for prose inside labelled context sections.
 const renderers: Components =
 variant === 'plan' ? planComponents
 : variant === 'section' ? sectionComponents
 : variant === 'compact' ? compactComponents
 : components
 // Plain texts skip the unified pipeline: same wrapper, same <p>
 // renderers, no remark parse (byte-identical paragraphs).
 const Paragraph = renderers.p
 if (isPlainChatText(text) && typeof Paragraph === 'function') {
 const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter((block) => block !== '')
 return (
 <div data-markdown="" className="min-w-0 [overflow-wrap:anywhere]">
 {blocks.map((block, index) => <Paragraph key={index}>{block}</Paragraph>)}
 </div>
 )
 }
 return (
 <div data-markdown="" className="min-w-0 [overflow-wrap:anywhere]">
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

// Memoized: every parent re-render (polls, typing, timers) would
// otherwise re-run remark over every mounted message. Props are
// strings, so the shallow compare is exact.
export const Markdown = memo(MarkdownView)
