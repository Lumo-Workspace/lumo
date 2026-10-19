'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SortState } from '../hooks/useTableSort'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface SortableHeaderProps<K extends string> {
  col: K
  label: string
  sort: SortState<K>
  onToggle: (key: K) => void
  className?: string
  tooltip?: string
  as?: 'th' | 'div'
}

export function SortableHeader<K extends string>({
  col,
  label,
  sort,
  onToggle,
  className,
  tooltip,
  as = 'th',
}: SortableHeaderProps<K>) {
  const active = sort.key === col

  const button = (
    <Button
      variant='ghost'
      onClick={() => onToggle(col)}
      className={cn(
        'h-auto px-0 gap-1 text-caption uppercase select-none hover:bg-transparent',
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
  )

  const content = tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    button
  )

  if (as === 'div') {
    return (
      <div role='columnheader' className={className}>
        {content}
      </div>
    )
  }

  return <th className={cn('border-b border-border', className)}>{content}</th>
}
