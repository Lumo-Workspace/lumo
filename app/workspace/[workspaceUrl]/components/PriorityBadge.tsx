import { cn } from '@/lib/utils'
import {
  BatteryWarning,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
} from 'lucide-react'
import { ApiPriority } from '../types'

const PRIORITY_CONFIG: Record<
  ApiPriority,
  { label: string; icon: React.ReactNode; color: string }
> = {
  URGENT: {
    label: 'Urgent',
    icon: <BatteryWarning size={13} />,
    color: 'text-red-500',
  },
  HIGH: {
    label: 'High',
    icon: <BatteryLow size={13} />,
    color: 'text-orange-500',
  },
  MEDIUM: {
    label: 'Medium',
    icon: <BatteryMedium size={13} />,
    color: 'text-yellow-500',
  },
  LOW: {
    label: 'Low',
    icon: <BatteryFull size={13} />,
    color: 'text-green-500',
  },
}

export function PriorityBadge({ priority }: { priority: ApiPriority }) {
  const { label, icon, color } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', color)}>
      {icon}
      {label}
    </span>
  )
}
