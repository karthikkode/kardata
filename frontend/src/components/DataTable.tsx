// DataTable (F10): headless TanStack table with our tokens. Sticky
// header, sortable columns (aria-sort), row hover recipe, empty / loading
// / error slots, footer slot for paging. Below sm each row becomes a
// stacked card (see .v2-table-stack in index.css). Interactive rows are
// single router links (role=link, Enter activates); cells never nest a
// second link. First-click direction follows the value type (TanStack
// auto direction): text A-first, numbers largest-first.
import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'
import { tableRowClassName } from './ui/list'

export interface DataTableColumn<T extends object> {
  id: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number | null
  align?: 'left' | 'right'
  /** Stacked-card label below sm. '' hides the label (name cells). */
  stackedLabel?: string
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export function DataTable<T extends object>({
  data,
  columns,
  rowKey,
  onSelect,
  defaultSort = [],
  onSortChange,
  state = 'ready',
  rowLimit,
  empty,
  loading,
  error,
  footer,
  ariaLabel,
  className,
}: {
  data: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T) => string
  onSelect?: (row: T) => void
  defaultSort?: SortingState
  onSortChange?: (sort: SortingState) => void
  state?: 'ready' | 'loading' | 'error'
  /** Client-side window: sorts the full data, then shows the first N rows. */
  rowLimit?: number
  empty: React.ReactNode
  loading?: React.ReactNode
  error?: React.ReactNode
  footer?: React.ReactNode
  ariaLabel: string
  className?: string
}) {
  const [sorting, setSorting] = React.useState<SortingState>(defaultSort)
  const tableColumns = React.useMemo(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: () => column.header,
        cell: ({ row }: { row: { original: T } }) => column.cell(row.original),
        // TanStack gates sorting on an accessor: without one the column
        // silently renders unsortable (no button, no aria-sort).
        accessorFn: (row: T) => (column.sortValue ? column.sortValue(row) : null),
        enableSorting: column.sortValue !== undefined,
        sortingFn: column.sortValue
          ? (a: { original: T }, b: { original: T }) =>
              compareValues(
                (column.sortValue as (row: T) => string | number | null)(a.original),
                (column.sortValue as (row: T) => string | number | null)(b.original),
              )
          : undefined,
      })),
    [columns],
  )
  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setSorting(next)
      onSortChange?.(next)
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const sortedRows = table.getRowModel().rows
  const visibleRows = rowLimit === undefined ? sortedRows : sortedRows.slice(0, rowLimit)
  const body =
    state === 'loading' ? (
      <tr>
        <td colSpan={columns.length} className="px-2 py-2">
          {loading}
        </td>
      </tr>
    ) : state === 'error' ? (
      <tr>
        <td colSpan={columns.length} className="px-2 py-2">
          {error}
        </td>
      </tr>
    ) : sortedRows.length === 0 ? (
      <tr>
        <td colSpan={columns.length} className="px-2 py-2">
          {empty}
        </td>
      </tr>
    ) : (
      visibleRows.map((row) => {
        const interactive = onSelect !== undefined
        return (
          <tr
            key={rowKey(row.original)}
            data-list-row=""
            className={cn(tableRowClassName({ interactive }), 'h-9 border-b border-border-subtle last:border-b-0')}
            {...(interactive
              ? {
                  role: 'link' as const,
                  tabIndex: 0,
                  onClick: () => onSelect?.(row.original),
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onSelect?.(row.original)
                    }
                  },
                }
              : {})}
          >
            {row.getVisibleCells().map((cell) => {
              const column = columns[cell.column.getIndex()] as DataTableColumn<T>
              return (
                <td
                  key={cell.column.id}
                  data-label={column.stackedLabel ?? (typeof column.header === 'string' ? column.header : '')}
                  className={cn('px-2 py-2 align-middle', column.align === 'right' && 'text-right')}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              )
            })}
          </tr>
        )
      })
    )

  return (
    <div className={className}>
      <table aria-label={ariaLabel} className="v2-table-stack w-full border-collapse text-left">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const column = columns[header.column.getIndex()] as DataTableColumn<T>
                const sorted = header.column.getIsSorted()
                const sortable = header.column.getCanSort()
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sortable ? (sorted === 'desc' ? 'descending' : sorted === 'asc' ? 'ascending' : 'none') : undefined}
                    className={cn(
                      'h-9 border-b border-border-subtle bg-card px-2 align-middle text-ui font-medium text-muted-foreground',
                      column.align === 'right' && 'text-right',
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${typeof column.header === 'string' ? column.header : column.id}`}
                        className={cn(
                          'inline-flex h-full w-full cursor-pointer items-center gap-1.5 rounded-sm outline-none transition-colors duration-120 ease-out-soft hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                          column.align === 'right' && 'justify-end',
                          sorted ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <Icons.sort aria-hidden className={cn('size-3.5 shrink-0 transition-transform duration-180 ease-out', sorted === 'desc' && 'rotate-180')} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>{body}</tbody>
      </table>
      {footer}
    </div>
  )
}
