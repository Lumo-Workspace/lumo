import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ApiPriority } from '../types'

const PRIORITY_CONFIG: Record<
  ApiPriority,
  { label: string; className: string }
> = {
  URGENT: {
    label: 'Urgent',
    className:
      'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900/50',
  },
  HIGH: {
    label: 'High',
    className:
      'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/30 dark:border-orange-900/50',
  },
  MEDIUM: {
    label: 'Medium',
    className:
      'text-zinc-600 bg-zinc-100 border-zinc-200 dark:text-zinc-300 dark:bg-zinc-800 dark:border-zinc-700',
  },
  LOW: {
    label: 'Low',
    className:
      'text-zinc-400 bg-zinc-50 border-zinc-200 dark:text-zinc-500 dark:bg-zinc-800/50 dark:border-zinc-700',
  },
}

export function PriorityBadge({ priority }: { priority: ApiPriority }) {
  const { label, className } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <Badge variant='outline' className={cn('font-medium', className)}>
      {label}
    </Badge>
  )
}
