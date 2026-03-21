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
import { useState } from 'react'
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
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
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
          table.getRowModel().rows.map(row => (
            <TableRow
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className='cursor-pointer group'
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
          ))
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
