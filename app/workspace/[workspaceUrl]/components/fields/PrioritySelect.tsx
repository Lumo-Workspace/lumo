'use client'

import { useIntl } from 'react-intl'
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
import {
  PRIORITY_CONFIG,
  PRIORITY_LABEL_ID,
  PriorityDot,
  fieldTriggerProps,
  type FieldVariant,
} from './shared'

export interface PrioritySelectProps {
  value: ApiPriority
  onChange: (v: ApiPriority) => void
  triggerClassName?: string
  /** LUM-1274: `ghost` = borderless inline row (task detail panel). */
  variant?: FieldVariant
}

export function PrioritySelect({
  value,
  onChange,
  triggerClassName,
  variant,
}: PrioritySelectProps) {
  const intl = useIntl()
  const label = intl.formatMessage({
    id: PRIORITY_LABEL_ID[value] ?? PRIORITY_LABEL_ID.NONE,
  })
  return (
    <Select value={value} onValueChange={v => onChange(v as ApiPriority)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            {...fieldTriggerProps(variant)}
            className={triggerClassName}
          >
            <div className='flex items-center gap-1.5'>
              <PriorityDot priority={value} />
              <span>{label}</span>
            </div>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({
            id: 'task.priority',
            defaultMessage: 'Priority',
          })}
          : {label}
        </TooltipContent>
      </Tooltip>
      <SelectContent>
        {(
          Object.entries(PRIORITY_CONFIG) as [
            ApiPriority,
            (typeof PRIORITY_CONFIG)[ApiPriority],
          ][]
        ).map(([val]) => (
          <SelectItem key={val} value={val}>
            <div className='flex items-center gap-2'>
              <PriorityDot priority={val} />
              {intl.formatMessage({ id: PRIORITY_LABEL_ID[val] })}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
