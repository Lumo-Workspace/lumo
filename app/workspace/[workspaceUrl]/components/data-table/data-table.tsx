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

  interface TableMeta<TData extends RowData> {
    expanded?: Set<string>
    toggleExpand?: (id: string) => void
    getParentId?: (row: TData) => string | null
    getChildCount?: (row: TData) => number
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface TreeConfig<TData> {
  getParentId: (row: TData) => string | null
  getChildCount: (row: TData) => number
  getRowId: (row: TData) => string
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  treeConfig?: TreeConfig<TData>
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  treeConfig,
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

  const getParentId = treeConfig?.getParentId

  // Build tree: root tasks in order, children inserted after their parent
  const visibleData = useMemo(() => {
    if (!getParentId || !treeConfig) return data
    const { getRowId } = treeConfig
    // Group children by parentId
    const childrenMap = new Map<string, TData[]>()
    const roots: TData[] = []
    for (const row of data) {
      const parentId = getParentId(row)
      if (!parentId) {
        roots.push(row)
      } else {
        const siblings = childrenMap.get(parentId)
        if (siblings) siblings.push(row)
        else childrenMap.set(parentId, [row])
      }
    }
    // Flatten: root tasks, each followed by children if expanded
    const result: TData[] = []
    for (const root of roots) {
      result.push(root)
      const id = getRowId(root)
      if (expanded.has(id)) {
        const children = childrenMap.get(id)
        if (children) result.push(...children)
      }
    }
    return result
  }, [data, getParentId, treeConfig, expanded])

  const table = useReactTable({
    data: visibleData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    ...(treeConfig && {
      meta: {
        expanded,
        toggleExpand,
        getParentId: treeConfig.getParentId,
        getChildCount: treeConfig.getChildCount,
      },
    }),
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
