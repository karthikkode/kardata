import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelsPanel } from '@/components/ModelsPanel'
import { ModelToolbar } from '@/components/ModelToolbar'
import { notify } from '@/lib/toast'
import type { StagingConfig } from '@/data/staging-api'

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

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
    render(<ModelsPanel config={config} />)
    expect(await screen.findByText('Meta')).toBeInTheDocument()
    expect(screen.getByText('Key configured')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(await screen.findByText('Server chat uses Meta · muse-spark-1.3-contributor · High effort')).toBeInTheDocument()
    expect(screen.queryByText('DeepSeek')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Effort' })).toHaveTextContent('high')
  })

  it('saves a changed model and effort', async () => {
    const calls = stubApi((url, init) => {
      if (url.endsWith('/v1/sessions/s-1/model') && init.method === 'PATCH') {
        return { status: 200, payload: { ok: true, data: JSON.parse(init.body ?? '{}') } }
      }
      return baseHandler(url)
    })
    render(<ModelsPanel config={config} />)
    await screen.findByText('Meta')
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.click(await screen.findByRole('option', { name: 'muse-spark-1.3' }))
    await user.click(screen.getByRole('combobox', { name: 'Effort' }))
    await user.click(await screen.findByRole('option', { name: 'low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save to session' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = calls.find((call) => call.method === 'PATCH')
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', reasoning: true, effort: 'low' })
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Saved'))
  })

  it('shows empty, error, and denied states without invented providers', async () => {
    stubApi((url) => url.endsWith('/v1/providers')
      ? { status: 200, payload: { ok: true, data: { defaultProvider: 'meta', providers: [] } } }
      : baseHandler(url))
    const empty = render(<ModelsPanel config={config} />)
    expect(await screen.findByText(/No providers listed/)).toBeInTheDocument()
    empty.unmount()
    vi.unstubAllGlobals()
    stubApi(() => ({ status: 503, payload: { ok: false, error: { code: 'overload', message: 'offline' } } }))
    const error = render(<ModelsPanel config={config} />)
    expect(await screen.findByText('Models did not load.')).toBeInTheDocument()
    error.unmount()
    vi.unstubAllGlobals()
    stubApi(() => ({ status: 403, payload: { ok: false, error: { code: 'permission_denied', message: 'no' } } }))
    render(<ModelsPanel config={config} />)
    expect(await screen.findByText('Models are not shared with this key.')).toBeInTheDocument()
  })

  it('explains missing backend configuration', () => {
    render(<ModelsPanel config={null} />)
    expect(screen.getByText('Models need a backend connection.')).toBeInTheDocument()
  })
})

// Menu placement is owned by the Base UI menu primitive now: collision and
// bottom-docked opening are pinned by the CP-03 browser shots, not units.

describe('chat model picker', () => {
  function handler(url: string, init: { method?: string; body?: string }): { status: number; payload: unknown } {
    if (url.endsWith('/v1/providers')) return { status: 200, payload: { ok: true, data: catalog } }
    if (url.endsWith('/v1/sessions/s-1/model') && init.method === 'PATCH') return { status: 200, payload: { ok: true, data: JSON.parse(init.body ?? '{}') } }
    if (url.includes('/v1/sessions/')) return { status: 200, payload: { ok: true, data: { ...session, model: stored } } }
    throw new Error(`unexpected url ${url}`)
  }

  // Base UI names each popup after its trigger (aria-labelledby wins
  // over aria-label), so tests take menus positionally: the first
  // portal holds the root menu, the last the open submenu.
  async function openModelsMenu() {
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    const [menu] = await screen.findAllByRole('menu')
    return menu as HTMLElement
  }
  async function openSubmenu(menu: HTMLElement, name: string | RegExp) {
    fireEvent.click(within(menu).getByRole('menuitem', { name }))
    const menus = await screen.findAllByRole('menu')
    return menus[menus.length - 1] as HTMLElement
  }

  it('shows the stored Contributor high binding in one chip', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger).toHaveTextContent('high')
    expect(screen.queryByRole('button', { name: 'Choose reasoning effort' })).not.toBeInTheDocument()
  })

  it('shows the generic pill only when asked (legacy panels)', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" modelLabel="generic" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('Model')
    expect(trigger).not.toHaveTextContent('muse-spark-1.3-contributor')
  })

  it('seeds an unbound session from the Meta high default', async () => {
    stubApi((url, init) => url.includes('/v1/sessions/') && init.method !== 'PATCH'
      ? { status: 200, payload: { ok: true, data: session } }
      : handler(url, init))
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger).toHaveTextContent('high')
  })

  it('renders the trigger without a bordered container', async () => {
    stubApi(handler)
    const { container } = render(<ModelToolbar config={config} sessionId="s-1" />)
    await screen.findByRole('button', { name: 'Choose a model' })
    expect(container.firstElementChild?.className ?? '').not.toContain('border')
  })

  it('changes effort from the model submenu and saves it', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const menu = await openModelsMenu()
    expect(menu.className).toContain('bg-popover')
    const submenu = await openSubmenu(menu, /muse-spark-1.3-contributor/)
    fireEvent.click(within(submenu).getByRole('menuitemradio', { name: 'low' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}')).toEqual({ provider: 'meta', model: contributor.model, reasoning: true, effort: 'low' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose a model' })).toHaveTextContent('low'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('sends the selected catalog entry provider instead of a hardcoded one', async () => {
    // The wire contract is Meta-only today (backend route and DB schemas
    // pin provider to the 'meta' literal), so the picker resolves the
    // selected entry and sends ITS name: the value below is read from the
    // catalog fixture, never written as a literal in the expectation.
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const menu = await openModelsMenu()
    // Unselected native-reasoning rows carry the Thinking caption, so the
    // accessible name is the display name plus caption.
    const submenu = await openSubmenu(menu, 'muse-spark-1.3 Thinking')
    fireEvent.click(within(submenu).getByRole('menuitemradio', { name: 'medium' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}')
    expect(patch.provider).toBe(catalog.providers[0]?.name)
    expect(patch).toEqual({ provider: catalog.providers[0]?.name, model: 'muse-spark-1.3', reasoning: true, effort: 'medium' })
  })

  it('filters models and lets keyboard users pick an effort', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    await openModelsMenu()
    const search = screen.getByLabelText('Search models')
    fireEvent.change(search, { target: { value: 'contributor' } })
    expect(screen.queryByRole('menuitem', { name: 'muse-spark-1.3' })).not.toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: /muse-spark-1.3-contributor/ })).toHaveFocus()
    fireEvent.keyDown(search, { key: 'Enter' })
    const menus = await screen.findAllByRole('menu')
    const submenu = menus[menus.length - 1] as HTMLElement
    fireEvent.click(within(submenu).getByRole('menuitemradio', { name: 'low' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}').effort).toBe('low')
  })

  it('changes effort from the standalone effort menu in split mode', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact bare display="effort" />)
    const trigger = await screen.findByRole('button', { name: 'Choose reasoning effort' })
    expect(trigger).toHaveTextContent('high')
    fireEvent.click(trigger)
    const [menu] = await screen.findAllByRole('menu')
    fireEvent.click(within(menu as HTMLElement).getByRole('menuitemradio', { name: 'low' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}')).toEqual({ provider: 'meta', model: contributor.model, reasoning: true, effort: 'low' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not render without a session', () => {
    stubApi(handler)
    const { container } = render(<ModelToolbar config={config} sessionId={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mounts one menu at a time and closes it with Escape', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a model' }))
    const menus = await screen.findAllByRole('menu')
    expect(menus).toHaveLength(1)
    fireEvent.keyDown(menus[0] as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves with arrow keys and returns focus to the trigger on Escape', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    fireEvent.click(trigger)
    const [menu] = await screen.findAllByRole('menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(menu as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('role')).toMatch(/menuitem/)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
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
    await screen.findAllByRole('menu')
    fireEvent.click(screen.getByRole('button', { name: 'Choose reasoning effort' }))
    await waitFor(() => expect(modelTrigger).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Choose reasoning effort' })).toHaveAttribute('aria-expanded', 'true')
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
    expect(await screen.findByRole('menuitem', { name: /muse-spark-1.3-contributor/ })).toBeInTheDocument()
  })

  it('caps the bare composer picker so long names truncate', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact bare display="model" />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger.parentElement?.className).toContain('max-w-40')
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

  it('switches model and effort from a non-selected submenu', async () => {
    const calls = stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" />)
    const menu = await openModelsMenu()
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    const submenu = await openSubmenu(menu, 'muse-spark-1.3 Thinking')
    fireEvent.click(within(submenu).getByRole('menuitemradio', { name: 'medium' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}')).toEqual({ provider: 'meta', model: 'muse-spark-1.3', reasoning: true, effort: 'medium' })
  })

  it('toggles reasoning for models without effort levels', async () => {
    const thinker = { provider: 'meta', model: 'thinker', displayName: 'thinker', reasoning: 'native', mode: 'responses', efforts: [] as string[] }
    const mini = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'thinker', models: [thinker] }] }
    const calls = stubApi((url: string, init: { method?: string; body?: string }) => {
      if (url.endsWith('/v1/providers')) return { status: 200, payload: { ok: true, data: mini } }
      if (url.endsWith('/v1/sessions/s-1/model') && init.method === 'PATCH') return { status: 200, payload: { ok: true, data: JSON.parse(init.body ?? '{}') } }
      if (url.includes('/v1/sessions/')) {
        return { status: 200, payload: { ok: true, data: { ...session, model: { provider: 'meta', model: 'thinker', reasoning: true } } } }
      }
      throw new Error(`unexpected url ${url}`)
    })
    render(<ModelToolbar config={config} sessionId="s-1" />)
    await openModelsMenu()
    const toggle = screen.getByRole('switch', { name: 'Reasoning' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}')).toEqual({ provider: 'meta', model: 'thinker', reasoning: false })
  })

  it('hides the standalone effort menu when the model has no levels', async () => {
    const thinker = { provider: 'meta', model: 'thinker', displayName: 'thinker', reasoning: 'native', mode: 'responses', efforts: [] as string[] }
    const mini = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'thinker', models: [thinker] }] }
    stubApi((url: string) => {
      if (url.endsWith('/v1/providers')) return { status: 200, payload: { ok: true, data: mini } }
      if (url.includes('/v1/sessions/')) {
        return { status: 200, payload: { ok: true, data: { ...session, model: { provider: 'meta', model: 'thinker', reasoning: true } } } }
      }
      throw new Error(`unexpected url ${url}`)
    })
    const { container } = render(<ModelToolbar config={config} sessionId="s-1" compact bare display="effort" />)
    await waitFor(() => expect(container.textContent ?? '').not.toMatch(/Loading/))
    expect(screen.queryByRole('button', { name: 'Choose reasoning effort' })).not.toBeInTheDocument()
  })

  it('compacts to a display-name chip without the provider label', async () => {
    stubApi(handler)
    render(<ModelToolbar config={config} sessionId="s-1" compact />)
    const trigger = await screen.findByRole('button', { name: 'Choose a model' })
    expect(trigger).toHaveTextContent('muse-spark-1.3-contributor')
    expect(trigger).not.toHaveTextContent('Meta')
    fireEvent.click(trigger)
    expect(await screen.findAllByRole('menu')).toHaveLength(1)
  })
})
