import { cn } from '@/lib/utils'
import { ApiPriority } from '../types'
import { PRIORITY_CONFIG } from './TaskFieldSelects'

export function PriorityBadge({ priority }: { priority: ApiPriority }) {
  const { label, icon, iconColor } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <span
      className={cn('flex items-center gap-1 text-xs font-medium', iconColor)}
    >
      {icon}
      {label}
    </span>
  )
}
