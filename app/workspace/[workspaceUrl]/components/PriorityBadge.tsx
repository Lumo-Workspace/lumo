import { cn } from '@/lib/utils'
import { ApiPriority } from '../types'
import { PRIORITY_CONFIG } from './TaskFieldSelects'

export function PriorityBadge({ priority }: { priority: ApiPriority }) {
  const { Icon, iconColor } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <span className={cn(iconColor)}>
      <Icon className='size-4' />
    </span>
  )
}
