import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ApiPriority } from '../types'
import { PRIORITY_CONFIG } from './fields'

export function PriorityBadge({ priority }: { priority: ApiPriority }) {
  const { Icon, iconColor, label } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(iconColor)}>
          <Icon className='size-4' />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
