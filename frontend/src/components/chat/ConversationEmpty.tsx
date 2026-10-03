// Empty conversation (CV-09), shared by the workspace and Karbot.
// Suggestion buttons fill the composer and focus it; they never send.
import { Icons } from '@/lib/icons'
import { CardTitle, Description } from '../text'
import { Button } from '../ui/button'

const SUGGESTIONS: Record<'research' | 'chat' | 'karbot', { title: string; description: string; prompts: [string, string, string] }> = {
  research: {
    title: 'Ask about this research',
    description: 'Questions, comparisons, and review requests stay in this thread.',
    prompts: ['Summarize progress so far', 'Which companies were found?', 'What needs my review?'],
  },
  chat: {
    title: 'Start a conversation',
    description: 'Brainstorm, compare, and draft against the sector context.',
    prompts: ['Brainstorm search directions', 'Compare two companies', 'Draft a plan outline'],
  },
  karbot: {
    title: 'Ask Karbot anything',
    description: 'Karbot sees every sector you can open.',
    prompts: ['What is running right now?', 'Create a new sector', 'Show recent companies'],
  },
}

export function ConversationEmpty({ variant, onSuggest }: { variant: 'research' | 'chat' | 'karbot'; onSuggest(text: string): void }) {
  const copy = SUGGESTIONS[variant]
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-12 text-center">
      <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icons.chatMessage className="size-5 text-muted-foreground" />
      </span>
      <CardTitle className="mt-3">{copy.title}</CardTitle>
      <Description className="mt-1 max-w-80">{copy.description}</Description>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {copy.prompts.map((prompt) => (
          <Button key={prompt} type="button" variant="secondary" size="sm" onClick={() => onSuggest(prompt)}>
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  )
}
