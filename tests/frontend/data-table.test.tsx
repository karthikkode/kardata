import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DataTable, type DataTableColumn } from '@/components/DataTable'

type Row = { id: string; name: string; count: number }

const ROWS: Row[] = [
  { id: 'b', name: 'Bravo', count: 30 },
  { id: 'a', name: 'Alpha', count: 100 },
  { id: 'c', name: 'Charlie', count: 20 },
]

const COLUMNS: Array<DataTableColumn<Row>> = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name },
  { id: 'count', header: 'Count', cell: (row) => String(row.count), sortValue: (row) => row.count, align: 'right' },
  { id: 'static', header: 'Static', cell: () => 'x' },
]

function names(): string[] {
  return within(screen.getByRole('table')).getAllByRole('link').map((row) => row.textContent ?? '')
}

describe('data table (F10)', () => {
  it('sorts text and numbers both directions with aria-sort', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    render(
      <DataTable
        data={ROWS}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        onSelect={() => undefined}
        onSortChange={onSortChange}
        empty="empty"
        ariaLabel="Sectors"
      />,
    )
    const table = screen.getByRole('table', { name: 'Sectors' })
    const nameHeader = within(table).getByRole('columnheader', { name: 'Name' })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')
    await user.click(within(nameHeader).getByRole('button', { name: 'Sort by Name' }))
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(names()[0]).toContain('Alpha')
    expect(onSortChange).toHaveBeenCalledWith([{ id: 'name', desc: false }])
    await user.click(within(nameHeader).getByRole('button', { name: 'Sort by Name' }))
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    expect(names()[0]).toContain('Charlie')
    const countHeader = within(table).getByRole('columnheader', { name: 'Count' })
    await user.click(within(countHeader).getByRole('button', { name: 'Sort by Count' }))
    expect(countHeader).toHaveAttribute('aria-sort', 'descending')
    expect(names()[0]).toContain('Alpha')
    await user.click(within(countHeader).getByRole('button', { name: 'Sort by Count' }))
    expect(countHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(names()[0]).toContain('Charlie')
  })

  it('leaves unsortable columns as plain headers', () => {
    render(
      <DataTable data={ROWS} columns={COLUMNS} rowKey={(row) => row.id} empty="empty" ariaLabel="Sectors" />,
    )
    const header = screen.getByRole('columnheader', { name: 'Static' })
    expect(header).not.toHaveAttribute('aria-sort')
    expect(within(header).queryByRole('button')).not.toBeInTheDocument()
  })

  it('activates rows by click and Enter key', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <DataTable
        data={ROWS}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        onSelect={onSelect}
        empty="empty"
        ariaLabel="Sectors"
      />,
    )
    const rows = within(screen.getByRole('table')).getAllByRole('link')
    await user.click(rows[0])
    expect(onSelect).toHaveBeenCalledWith(ROWS[0])
    rows[1].focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(ROWS[1])
  })

  it('renders plain rows without a select handler', () => {
    render(
      <DataTable data={ROWS} columns={COLUMNS} rowKey={(row) => row.id} empty="empty" ariaLabel="Sectors" />,
    )
    expect(within(screen.getByRole('table')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('Alpha')
  })

  it('slots empty, loading, and error states', () => {
    const base = {
      data: [] as Row[],
      columns: COLUMNS,
      rowKey: (row: Row) => row.id,
      empty: 'Nothing here yet',
      loading: 'Loading sectors',
      error: 'Sectors did not load',
      ariaLabel: 'Sectors',
    }
    const { rerender } = render(<DataTable {...base} />)
    expect(screen.getByRole('table')).toHaveTextContent('Nothing here yet')
    rerender(<DataTable {...base} state="loading" />)
    expect(screen.getByRole('table')).toHaveTextContent('Loading sectors')
    rerender(<DataTable {...base} state="error" />)
    expect(screen.getByRole('table')).toHaveTextContent('Sectors did not load')
  })

  it('renders the footer slot for paging', () => {
    render(
      <DataTable
        data={ROWS}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        empty="empty"
        ariaLabel="Sectors"
        footer={<button type="button">Show more</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })
})
