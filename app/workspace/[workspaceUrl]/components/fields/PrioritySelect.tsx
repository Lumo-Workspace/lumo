'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ApiPriority } from '../../types'
import { PRIORITY_CONFIG, PriorityIcon } from './shared'

export interface PrioritySelectProps {
  value: ApiPriority
  onChange: (v: ApiPriority) => void
  triggerClassName?: string
}

export function PrioritySelect({
  value,
  onChange,
  triggerClassName,
}: PrioritySelectProps) {
  const { label } = PRIORITY_CONFIG[value] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <Select value={value} onValueChange={v => onChange(v as ApiPriority)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            <div className='flex items-center gap-1.5'>
              <PriorityIcon priority={value} />
              <span>{label}</span>
            </div>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Priority</TooltipContent>
      </Tooltip>
      <SelectContent>
        {(
          Object.entries(PRIORITY_CONFIG) as [
            ApiPriority,
            (typeof PRIORITY_CONFIG)[ApiPriority],
          ][]
        ).map(([val, { label: lbl, Icon, iconColor }]) => (
          <SelectItem key={val} value={val}>
            <div className='flex items-center gap-2'>
              <span className={iconColor}>
                <Icon className='size-4' />
              </span>
              {lbl}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
