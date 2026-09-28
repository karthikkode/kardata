import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelsPanel } from '@/components/ModelsPanel'
import { ModelToolbar } from '@/components/ModelToolbar'
import type { StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }
const session = { id: 's-1', title: 'Server chat', createdAt: '', updatedAt: '' }
const contributor = { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] }
const spark = { ...contributor, model: 'muse-spark-1.3', displayName: 'muse-spark-1.3' }
const catalog = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: contributor.model, models: [contributor, spark] }] }
const stored = { provider: 'meta', model: contributor.model, reasoning: true, effort: 'high' }

type Handler = (url: string, init: { method?: string; body?: string }) => { status: number; payload: unknown }
function stubApi(handler: Handler) {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body })
    const result = handler(url, init)
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.payload }
  }))
  return calls
}
function baseHandler(url: string): { status: number; payload: unknown } {
  if (url.endsWith('/v1/providers')) return { status: 200, payload: { ok: true, data: catalog } }
  if (url.endsWith('/v1/sessions')) return { status: 200, payload: { ok: true, data: [session] } }
  if (url.includes('/v1/sessions/')) return { status: 200, payload: { ok: true, data: { ...session, model: stored } } }
  throw new Error(`unexpected url ${url}`)
}

beforeEach(() => {
  vi.stubEnv('VITE_STAGING_API', '1')
  vi.stubEnv('VITE_STAGING_URL', 'https://staging.test')
  vi.stubEnv('VITE_STAGING_KEY', 'key')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Meta-only Models tab', () => {
  it('shows Contributor at high effort and no DeepSeek card', async () => {
    stubApi(baseHandler)
    render(<ModelsPanel config={config} onBack={() => undefined} />)
    expect(await screen.findByText('Meta')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Server default')).toBeInTheDocument()
    expect(await screen.findByText(/Server chat uses Meta muse-spark-1.3-contributor, reasoning on, effort high/)).toBeInTheDocument()
    expect(screen.queryByText('DeepSeek')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Effort')).toHaveValue('high')
  })

  it('saves a changed model and effort', async () => {
    const calls = stubApi((url, init) => {
      if (url.endsWith('/v1/sessions/s-1/model') && init.method === 'PATCH') {
        return { status: 200, payload: { ok: true, data: JSON.parse(init.body ?? '{}') } }
      }
      return baseHandler(url)
    })
    render(<ModelsPanel config={config} onBack={() => undefined} />)
    await screen.findByText('Meta')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'muse-spark-1.3' } })
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to session' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = calls.find((call) => call.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', reasoning: true, effort: 'low' })
  })

  it('shows empty, error, and denied states without invented providers', async () => {
    stubApi((url) => url.endsWith('/v1/providers')
      ? { status: 200, payload: { ok: true, data: { defaultProvider: 'meta', providers: [] } } }
      : baseHandler(url))
    const empty = render(<ModelsPanel config={config} onBack={() => undefined} />)
    expect(await screen.findByText(/No providers listed/)).toBeInTheDocument()
    empty.unmount()
    vi.unstubAllGlobals()
    stubApi(() => ({ status: 503, payload: { ok: false, error: { code: 'overload', message: 'offline' } } }))
    const error = render(<ModelsPanel config={config} onBack={() => undefined} />)
    expect(await screen.findByText('Models did not load.')).toBeInTheDocument()
    error.unmount()
    vi.unstubAllGlobals()
    stubApi(() => ({ status: 403, payload: { ok: false, error: { code: 'permission_denied', message: 'no' } } }))
    render(<ModelsPanel config={config} onBack={() => undefined} />)
    expect(await screen.findByText('Models are not shared with this key.')).toBeInTheDocument()
  })

  it('explains missing backend configuration', () => {
    render(<ModelsPanel config={null} onBack={() => undefined} />)
    expect(screen.getByText('Models need a backend connection.')).toBeInTheDocument()
  })
})

describe('chat model picker', () => {
  function handler(url: string, init: { method?: string; body?: string }): { status: number; payload: unknown } {
    if (url.endsWith('/v1/providers')) return { status: 200, payload: { ok: true, data: catalog } }
    if (url.endsWith('/v1/sessions/s-1/model') && init.method === 'PATCH') return { status: 200, payload: { ok: true, data: JSON.parse(init.body ?? '{}') } }
    if (url.includes('/v1/sessions/')) return { status: 200, payload: { ok: true, data: { ...session, model: stored } } }
    throw new Error(`unexpected url ${url}`)
  }

  it('shows the stored Contributor high binding', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger).not.toHaveTextContent('high')
    expect(screen.getByRole('button', { name: 'Choose reasoning effort' })).toHaveTextContent('high')
  })

  it('seeds an unbound session from the Meta high default', async () => {
    stubApi((url, init) => url.includes('/v1/sessions/') && init.method !== 'PATCH'
      ? { status: 200, payload: { ok: true, data: session } }
      : handler(url, init))
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger).not.toHaveTextContent('high')
    expect(screen.getByRole('button', { name: 'Choose reasoning effort' })).toHaveTextContent('high')
  })

  it('changes effort from the pill dropdown and saves it', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose reasoning effort' }))
    const menu = await screen.findByRole('menu', { name: 'Reasoning effort' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'low' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}')).toEqual({ provider: 'meta', model: contributor.model, reasoning: true, effort: 'low' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose reasoning effort' })).toHaveTextContent('low'))
  })

  it('only offers Meta models from the catalog and saves a pick', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    expect(screen.queryByText('DeepSeek')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'muse-spark-1.3' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = calls.find((call) => call.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', reasoning: true, effort: 'high' })
  })

  it('filters models and lets keyboard users pick an effort', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'contributor' } })
    expect(screen.queryByRole('menuitemradio', { name: 'muse-spark-1.3' })).not.toBeInTheDocument()
    fireEvent.focus(screen.getByRole('menuitemradio', { name: 'muse-spark-1.3-contributor' }))
    const menu = await screen.findByRole('menu', { name: 'Effort for muse-spark-1.3-contributor' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'low' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}').effort).toBe('low')
  })

  it('does not render without a session', () => {
    stubApi(handler)
    const { container } = render(<ModelToolbar config={config} sessionId={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not mount ghost menus behind the open one', async () => {    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    await screen.findByRole('menu', { name: 'Models' })
    expect(screen.queryByRole('button', { name: 'Dismiss reasoning effort' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss models' }))
    await waitForElementToBeRemoved(() => screen.queryByRole('menu', { name: 'Models' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose reasoning effort' }))
    await screen.findByRole('menu', { name: 'Reasoning effort' })
    expect(screen.queryByRole('button', { name: 'Dismiss models' })).not.toBeInTheDocument()
  })

  it('moves focus into the menu on open without stealing the search field', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    fireEvent.click(trigger)
    const menu = await screen.findByRole('menu', { name: 'Models' })
    expect(menu).toHaveFocus()
    expect(screen.getByLabelText('Search models')).not.toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitForElementToBeRemoved(() => screen.queryByRole('menu', { name: 'Models' }))
    expect(trigger).toHaveFocus()
  })

  it('closes the other instance when a picker menu opens', async () => {
    stubApi(handler)
    render(
      <>
        <ModelToolbar config={config} sessionId="s-1" compact display="model" />
        <ModelToolbar config={config} sessionId="s-1" compact bare display="effort" />
      </>,
    )
    const modelTrigger = await screen.findByRole('button', { name: 'Choose a model' })
    fireEvent.click(modelTrigger)
    await screen.findByRole('menu', { name: 'Models' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose reasoning effort' }))
    await screen.findByRole('menu', { name: 'Reasoning effort' })
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('splits model and effort across header and composer', async () => {
    stubApi(handler)
    render(
      <>
        <ModelToolbar config={config} sessionId="s-1" compact display="model" />
        <ModelToolbar config={config} sessionId="s-1" compact bare display="effort" />
      </>,
    )
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Choose a model' })).toHaveLength(1))
    expect(screen.getAllByRole('button', { name: 'Choose reasoning effort' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Choose a model' })).toHaveTextContent('muse-spark-1.3-contributor')
  })

  it('shows a generic Model placeholder instead of the full name', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact bare display="model" modelLabel="generic" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('Model')
    expect(trigger).not.toHaveTextContent('muse-spark')
    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitemradio', { name: 'muse-spark-1.3-contributor' })).toBeInTheDocument()
  })

  it('caps the bare composer picker so long names truncate', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact bare display="model" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger.parentElement?.className).toContain('max-w-52')
  })

  it('hides the Thinking label in the bare composer picker', async () => {
    const thinker = { provider: 'meta', model: 'thinker', displayName: 'thinker', reasoning: 'native', mode: 'responses', efforts: [] as string[] }
    const mini = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'thinker', models: [thinker] }] }
    stubApi((url: string) => {
      if (url.endsWith('/v1/providers')) return { status: 200, payload: { ok: true, data: mini } }
      if (url.includes('/v1/sessions/')) {
        return { status: 200, payload: { ok: true, data: { ...session, model: { provider: 'meta', model: 'thinker', reasoning: true } } } }
      }
      throw new Error(`unexpected url ${url}`)
    })
    render(<ModelToolbar config={config} sessionId="s-1" compact bare display="model" />)
    await screen.findByRole('button', { name: 'Choose a model' })
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('does not open the effort flyout when hovering a non-selected model', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    const row = screen
      .getByRole('menuitemradio', { name: 'muse-spark-1.3' })
      .closest('[data-flyout-row]') as HTMLElement
    fireEvent.mouseEnter(row)
    expect(screen.queryByRole('menu', { name: /Effort for/ })).not.toBeInTheDocument()
    fireEvent.focus(screen.getByRole('menuitemradio', { name: 'muse-spark-1.3' }))
    expect(screen.queryByRole('menu', { name: /Effort for/ })).not.toBeInTheDocument()
  })

  it('opens the effort flyout on hover in model-only mode', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact display="model" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    const row = screen
      .getByRole('menuitemradio', { name: 'muse-spark-1.3-contributor' })
      .closest('[data-flyout-row]') as HTMLElement
    fireEvent.mouseEnter(row)
    const flyout = await screen.findByRole('menu', { name: 'Effort for muse-spark-1.3-contributor' })
    expect(within(flyout).getByRole('menuitemradio', { name: 'low' })).toBeInTheDocument()
  })

  it('opens the flyout on the side with viewport room', async () => {
    stubApi(handler)
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const rect = (left: number) =>
      ({ top: 200, left, right: left + 200, bottom: 230, width: 200, height: 30, x: left, y: 200, toJSON: () => ({}) }) as DOMRect
    render(<ModelToolbar config={config} sessionId="s-1" compact display="model" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    const row = screen
      .getByRole('menuitemradio', { name: 'muse-spark-1.3-contributor' })
      .closest('[data-flyout-row]') as HTMLElement
    spy.mockReturnValue(rect(600))
    fireEvent.mouseEnter(row)
    expect((await screen.findByRole('menu', { name: 'Effort for muse-spark-1.3-contributor' })).style.right).not.toBe('')
    spy.mockReturnValue(rect(10))
    fireEvent.mouseEnter(row)
    await waitFor(() =>
      expect(screen.getByRole('menu', { name: 'Effort for muse-spark-1.3-contributor' }).style.left).not.toBe(''),
    )
    spy.mockRestore()
  })

  it('compacts to a display-name pill with an upward effort menu', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger).not.toHaveTextContent('Meta')
    fireEvent.click(await screen.findByRole('button', { name: 'Choose reasoning effort' }))
    const menu = await screen.findByRole('menu', { name: 'Reasoning effort' })
    expect(menu.className).toContain('bottom-full')
  })
})
