import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GlobalContextPanel, WorkspaceFiles } from '@/components/workspace-parts'
import type { ContextChange, ContextFileBlock, GlobalContext } from '@/data/api/context'
import type { LibraryFile } from '@/data/api/files'

function block(overrides: Partial<ContextFileBlock> = {}): ContextFileBlock {
  return { fileId: 'file-1', filename: 'notes.md', state: 'ready', tokens: 1240, summary: '### notes.md (MD)\n**Overview.** TEST summary.', error: null, ...overrides }
}

function globalWith(files: ContextFileBlock[], changes: ContextChange[] = []): GlobalContext {
  return {
    sectorId: 'sec-1', version: 3, researchSessionId: null,
    sections: { scope: 'Scope', instructions: '', decisions: '', findings: '', questions: '' },
    markdown: '## Scope\nScope', changes, files,
    usage: { total: 1245, budget: 30000, method: 'estimated', bySection: { scope: 2, instructions: 0, decisions: 0, findings: 3, questions: 0 }, byFile: files.map((file) => ({ fileId: file.fileId, tokens: file.tokens })) },
  }
}

function change(overrides: Partial<ContextChange> = {}): ContextChange {
  return {
    id: 'change-1', baseVersion: 2, sections: { scope: 'Scope', instructions: '', decisions: 'D', findings: 'F', questions: '' },
    sourceThread: 'owner', author: 'owner', state: 'approved', version: 2, at: '2026-10-01T00:00:00.000Z', fileRef: null, ...overrides,
  }
}

function renderPanel(files: ContextFileBlock[], onSummarize = vi.fn()) {
  return render(
    <GlobalContextPanel
      resource={{ status: 'ready', data: globalWith(files), refresh: vi.fn() }}
      preview={{ status: 'loading', refresh: vi.fn() }}
      busy={false}
      onReview={vi.fn()}
      onSave={vi.fn(async () => true)}
      onDecision={vi.fn(async () => true)}
      onSummarize={onSummarize}
    />,
  )
}

describe('context file blocks', () => {
  it('renders each block with its token count', () => {
    renderPanel([block(), block({ fileId: 'file-2', filename: 'report.pdf', tokens: 42, summary: '### report.pdf (PDF)\n**Overview.** TEST pdf.' })])
    const list = screen.getByRole('list', { name: 'Context files' })
    expect(within(list).getByRole('button', { name: 'notes.md, ready' })).toBeInTheDocument()
    expect(screen.getByText('1,240 tokens')).toBeInTheDocument()
    expect(screen.getByText('42 tokens')).toBeInTheDocument()
  })

  it('expands a ready summary in place', async () => {
    const user = userEvent.setup()
    renderPanel([block()])
    expect(screen.queryByText('TEST summary.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'notes.md, ready' }))
    expect(screen.getByText('TEST summary.')).toBeInTheDocument()
  })

  it('shows summarizing, failed and legacy states with their actions', async () => {
    const user = userEvent.setup()
    const onSummarize = vi.fn()
    renderPanel([
      block({ fileId: 'a', filename: 'a.md', state: 'summarizing', tokens: 0, summary: '' }),
      block({ fileId: 'b', filename: 'b.md', state: 'failed', tokens: 0, summary: '', error: 'TEST boom' }),
      block({ fileId: 'c', filename: 'c.md', state: 'legacy', tokens: 0, summary: '' }),
    ], onSummarize)
    expect(screen.getByText('Summarizing')).toBeInTheDocument()
    expect(screen.getByText('TEST boom')).toBeInTheDocument()
    expect(screen.getByText('Needs summary')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onSummarize).toHaveBeenCalledWith('b')
    await user.click(screen.getByRole('button', { name: 'Summarize' }))
    expect(onSummarize).toHaveBeenCalledWith('c')
  })

  it('shows an empty state when no files are added', () => {
    renderPanel([])
    expect(screen.getByText('No files in global context yet')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Context files' })).not.toBeInTheDocument()
  })

  it('removes a block with no confirm dialog', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <GlobalContextPanel
        resource={{ status: 'ready', data: globalWith([block()]), refresh: vi.fn() }}
        preview={{ status: 'loading', refresh: vi.fn() }}
        busy={false}
        onReview={vi.fn()}
        onSave={vi.fn(async () => true)}
        onDecision={vi.fn(async () => true)}
        onRemove={onRemove}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Remove notes.md from global context' }))
    expect(onRemove).toHaveBeenCalledWith('file-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers removal on included file rows', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const file: LibraryFile = { id: 'file-1', filename: 'notes.md', status: 'indexed', source: 'Uploaded', hash: 'a'.repeat(64), hidden: false, included: true, kind: 'document' }
    render(<WorkspaceFiles resource={{ status: 'ready', data: [file], refresh: vi.fn() }} busy={false} onUpload={vi.fn()} onHide={vi.fn()} onInclude={vi.fn()} onRemove={onRemove} />)
    await user.click(screen.getByRole('button', { name: 'Remove notes.md from global context' }))
    expect(onRemove).toHaveBeenCalledWith('file-1')
  })
})

describe('context usage bar', () => {
  function renderUsage(total: number, byFile: Array<{ fileId: string; tokens: number }> = []) {
    const files = byFile.map((file, index) => block({ fileId: file.fileId, filename: `f${index}.md`, tokens: file.tokens }))
    const data = globalWith(files)
    data.usage = { total, budget: 30000, method: 'estimated', bySection: { scope: total, instructions: 0, decisions: 0, findings: 0, questions: 0 }, byFile }
    return render(
      <GlobalContextPanel
        resource={{ status: 'ready', data, refresh: vi.fn() }}
        preview={{ status: 'loading', refresh: vi.fn() }}
        busy={false}
        onReview={vi.fn()}
        onSave={vi.fn(async () => true)}
        onDecision={vi.fn(async () => true)}
      />,
    )
  }

  it('shows the count and changes tone at the thresholds', () => {
    const { unmount } = renderUsage(100)
    expect(screen.getByText('100 of 30,000 tokens')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="progress"]')?.className ?? '').not.toContain('bg-warning')
    unmount()
    renderUsage(21000)
    expect(document.querySelector('[data-slot="progress"]')?.className ?? '').toContain('bg-warning')
  })

  it('uses the danger tone at and past the budget', () => {
    renderUsage(30000)
    expect(document.querySelector('[data-slot="progress"]')?.className ?? '').toContain('bg-danger')
  })

  it('opens the per-section and per-file breakdown', async () => {
    const user = userEvent.setup()
    const view = renderUsage(1500, [{ fileId: 'file-9', tokens: 1240 }])
    await user.click(screen.getByRole('button', { name: /Global context token usage/ }))
    const breakdown = screen.getByRole('list', { name: 'Token usage breakdown' })
    expect(within(breakdown).getByText('Scope')).toBeInTheDocument()
    expect(within(breakdown).getByText('1,500')).toBeInTheDocument()
    expect(within(breakdown).getByText('f0.md')).toBeInTheDocument()
    expect(within(breakdown).getByText('1,240')).toBeInTheDocument()
    view.unmount()
  })
})

describe('context compaction and restore', () => {
  function renderHistory(changes: ContextChange[], handlers: { onCompact?: () => void; onRestore?: (version: number) => Promise<boolean> } = {}) {
    return render(
      <GlobalContextPanel
        resource={{ status: 'ready', data: globalWith([], changes), refresh: vi.fn() }}
        preview={{ status: 'loading', refresh: vi.fn() }}
        busy={false}
        onReview={vi.fn()}
        onSave={vi.fn(async () => true)}
        onDecision={vi.fn(async () => true)}
        {...handlers}
      />,
    )
  }

  it('offers Compact now from the panel options menu', async () => {
    const user = userEvent.setup()
    const onCompact = vi.fn()
    const view = renderHistory([], { onCompact })
    await user.click(screen.getByRole('button', { name: 'Global context options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Compact now' }))
    expect(onCompact).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('starts a rewrite from the direction dialog', async () => {
    const user = userEvent.setup()
    const onRewrite = vi.fn(async () => true)
    const view = render(
      <GlobalContextPanel
        resource={{ status: 'ready', data: globalWith([]), refresh: vi.fn() }}
        preview={{ status: 'loading', refresh: vi.fn() }}
        busy={false}
        onReview={vi.fn()}
        onSave={vi.fn(async () => true)}
        onDecision={vi.fn(async () => true)}
        onRewrite={onRewrite}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Global context options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rewrite with a direction…' }))
    expect(screen.getByText('For example: the context leans toward X, give more weight to Y.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start rewrite' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'What should change?' }), 'weigh commercial work')
    await user.click(screen.getByRole('button', { name: 'Start rewrite' }))
    expect(onRewrite).toHaveBeenCalledWith('weigh commercial work')
    view.unmount()
  })

  it('opens the full context as a formatted document and copies it', async () => {
    const user = userEvent.setup()
    const onCopied = vi.fn()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const data = globalWith([block()])
    data.markdown = '## Scope\nScope\n\n## Instructions\nDo this.\n\n## Decisions\nD\n\n## Findings\nF\n\n## Open questions\nQ\n\n## Files\n### notes.md (MD)'
    const view = render(
      <GlobalContextPanel
        resource={{ status: 'ready', data, refresh: vi.fn() }}
        preview={{ status: 'loading', refresh: vi.fn() }}
        busy={false}
        onReview={vi.fn()}
        onSave={vi.fn(async () => true)}
        onDecision={vi.fn(async () => true)}
        onCopied={onCopied}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Open full view' }))
    const dialog = screen.getByRole('dialog', { name: 'Global context' })
    expect(within(dialog).getByText('v3 · 1,245 tokens')).toBeInTheDocument()
    for (const heading of ['Scope', 'Instructions', 'Decisions', 'Findings', 'Open questions', 'Files']) {
      expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    await user.click(within(dialog).getByRole('button', { name: 'Copy as Markdown' }))
    expect(writeText).toHaveBeenCalledWith(data.markdown)
    expect(onCopied).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('labels compaction revisions and restores through a confirm', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn(async () => true)
    renderHistory([
      change({ id: 'c-auto', author: 'system:compaction', sourceThread: 'compaction:auto', version: 2 }),
      change({ id: 'c-manual', author: 'system:compaction', sourceThread: 'compaction:manual', version: 1 }),
    ], { onRestore })
    await user.click(screen.getByRole('button', { name: 'Context history' }))
    expect(screen.getByText('Auto-compacted · v2')).toBeInTheDocument()
    expect(screen.getByText('Compacted · v1')).toBeInTheDocument()
    const revisions = screen.getByRole('list', { name: 'Context revisions' })
    const rows = within(revisions).getAllByRole('button')
    await user.click(rows[0]!)
    await user.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(screen.getByRole('alertdialog', { name: 'Restore version 2?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore version' }))
    expect(onRestore).toHaveBeenCalledWith(2)
  })
})
