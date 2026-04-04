'use client'

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table'
import { useState, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'

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
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  getParentId?: (row: TData) => string | null
  getChildCount?: (row: TData) => number
  getRowId?: (row: TData) => string
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  getParentId,
  getChildCount,
  getRowId,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Filter data to show root tasks + children of expanded parents
  const visibleData = useMemo(() => {
    if (!getParentId || !getRowId) return data
    return data.filter(row => {
      const parentId = getParentId(row)
      // Root tasks (no parent) are always visible
      if (!parentId) return true
      // Children are visible only if their parent is expanded
      return expanded.has(parentId)
    })
  }, [data, getParentId, getRowId, expanded])

  const table = useReactTable({
    data: visibleData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    meta: { expanded, toggleExpand, getParentId, getChildCount, getRowId },
  })

  return (
    <table className='w-full text-sm'>
      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <thead className='sticky top-0 bg-background/95 backdrop-blur-sm z-10'>
        {table.getHeaderGroups().map(headerGroup => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map(header => (
              <th
                key={header.id}
                className={cn(
                  'border-b border-border py-2.5 text-left',
                  header.column.columnDef.meta?.headerClassName
                )}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
              </th>
            ))}
          </tr>
        ))}
      </thead>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <TableBody>
        {table.getRowModel().rows.length > 0 ? (
          table.getRowModel().rows.map(row => {
            const isChild = getParentId?.(row.original) != null
            return (
              <TableRow
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={cn(
                  'cursor-pointer group',
                  isChild && 'bg-zinc-50/50 dark:bg-zinc-900/50'
                )}
              >
                {row.getVisibleCells().map(cell => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'py-3',
                      cell.column.columnDef.meta?.cellClassName
                    )}
                    onClick={
                      cell.column.columnDef.meta?.stopPropagation
                        ? e => e.stopPropagation()
                        : undefined
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            )
          })
        ) : (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className='h-24 text-center text-muted-foreground'
            >
              No tasks found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </table>
  )
}
