'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SortState } from '../hooks/useTableSort'

interface SortableHeaderProps<K extends string> {
  col: K
  label: string
  sort: SortState<K>
  onToggle: (key: K) => void
  className?: string
}

export function SortableHeader<K extends string>({
  col,
  label,
  sort,
  onToggle,
  className,
}: SortableHeaderProps<K>) {
  const active = sort.key === col

  return (
    <th
      className={cn('border-b border-zinc-200 dark:border-zinc-800', className)}
    >
      <button
        onClick={() => onToggle(col)}
        className={cn(
          'flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors select-none',
          active
            ? 'text-zinc-900 dark:text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
        )}
      >
        {label}
        {active && sort.dir === 'asc' ? (
          <ChevronUp size={12} className='text-zinc-900 dark:text-zinc-100' />
        ) : active && sort.dir === 'desc' ? (
          <ChevronDown size={12} className='text-zinc-900 dark:text-zinc-100' />
        ) : (
          <ChevronsUpDown size={12} className='text-zinc-400 opacity-40' />
        )}
      </button>
    </th>
  )
}
