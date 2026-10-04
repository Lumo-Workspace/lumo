'use client'

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import { useState, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import {
  shouldVirtualize,
  LIST_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'

// ─── ColumnMeta type augmentation ────────────────────────────────────────────
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra classes applied to every <th> in this column */
    headerClassName?: string
    /** Extra classes applied to every <td> in this column */
    cellClassName?: string
    /**
     * When true the cell's click event is stopped from reaching the row
     * onClick handler — use for action/control columns.
     */
    stopPropagation?: boolean
    /** CSS grid track for this column (used by the grid renderer). */
    gridWidth?: string
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  enableSelection?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: (selection: RowSelectionState) => void
  getRowId?: (row: TData) => string
  /** grid-template-columns; one track per visible column. */
  columnTemplate: string
  /** Empty-state text. */
  emptyLabel?: string
  /**
   * Render inside the page's own scroll flow: the table grows to its content
   * instead of owning an internal scroll region, and virtualization is off
   * (a virtualizer needs a bounded scroll parent). Used by single-page detail
   * layouts that must not nest a second scrollbar.
   */
  flow?: boolean
}

const ROW_HEIGHT = 49 // px — rows are single-line

// ─── Component ────────────────────────────────────────────────────────────────
export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  enableSelection,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  columnTemplate,
  emptyLabel,
  flow,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    enableRowSelection: enableSelection ?? false,
    state: { sorting, rowSelection: rowSelection ?? {} },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next =
        typeof updater === 'function' ? updater(rowSelection ?? {}) : updater
      onRowSelectionChange?.(next)
    },
    getRowId:
      getRowId ??
      ((row, index) => String((row as { id?: string }).id ?? index)),
  })

  const rows = table.getRowModel().rows
  const virtualize =
    !flow && shouldVirtualize(rows.length, LIST_VIRTUALIZE_THRESHOLD)

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualize,
  })

  const headerGroup = table.getHeaderGroups()[0]

  const renderRow = (row: (typeof rows)[number]) => {
    return (
      <div
        role='row'
        className='grid items-center group border-b border-border hover:bg-muted/50 transition-colors cursor-pointer'
        style={{ gridTemplateColumns: columnTemplate, height: ROW_HEIGHT }}
        onClick={() => onRowClick?.(row.original)}
      >
        {row.getVisibleCells().map(cell => (
          <div
            role='cell'
            key={cell.id}
            className={cn('px-0', cell.column.columnDef.meta?.cellClassName)}
            onClick={
              cell.column.columnDef.meta?.stopPropagation
                ? e => e.stopPropagation()
                : undefined
            }
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      role='table'
      className={cn('text-sm', !flow && 'flex-1 min-h-0 overflow-auto')}
    >
      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <div role='rowgroup'>
        <div
          role='row'
          className='grid sticky top-0 z-sticky bg-background/80 backdrop-blur-sm border-b border-border'
          style={{ gridTemplateColumns: columnTemplate }}
        >
          {headerGroup?.headers.map(header => (
            <div
              role='columnheader'
              key={header.id}
              className={cn(
                'py-2.5',
                header.column.columnDef.meta?.headerClassName
              )}
            >
              {header.isPlaceholder
                ? null
                : flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div role='rowgroup'>
          <div className='h-24 flex items-center justify-center text-center text-muted-foreground'>
            {emptyLabel ?? 'No tasks found.'}
          </div>
        </div>
      ) : virtualize ? (
        <div
          role='rowgroup'
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map(vi => {
            const row = rows[vi.index]
            if (!row) return null
            return (
              <div
                key={row.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {renderRow(row)}
              </div>
            )
          })}
        </div>
      ) : (
        <div role='rowgroup'>
          {rows.map(row => (
            <div key={row.id}>{renderRow(row)}</div>
          ))}
        </div>
      )}
    </div>
  )
}
