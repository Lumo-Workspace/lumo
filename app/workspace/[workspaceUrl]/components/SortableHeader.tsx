'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SortState } from '../hooks/useTableSort'
import { Button } from '@/components/ui/button'

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
    <th className={cn('border-b border-border', className)}>
      <Button
        variant='ghost'
        onClick={() => onToggle(col)}
        className={cn(
          'h-auto px-0 gap-1 text-[11px] font-medium uppercase tracking-wider select-none hover:bg-transparent',
          active
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label}
        {active && sort.dir === 'asc' ? (
          <ChevronUp size={12} />
        ) : active && sort.dir === 'desc' ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className='opacity-40' />
        )}
      </Button>
    </th>
  )
}
