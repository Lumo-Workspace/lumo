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
import { StatusIcon } from '../StatusIcon'
import type { ApiStatus } from '../../types'
import { API_STATUS_LABEL } from '../../utils'

export interface StatusSelectProps {
  value: ApiStatus
  onChange: (v: ApiStatus) => void
  triggerClassName?: string
}

export function StatusSelect({
  value,
  onChange,
  triggerClassName,
}: StatusSelectProps) {
  const intl = useIntl()
  return (
    <Select value={value} onValueChange={v => onChange(v as ApiStatus)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            <div className='flex items-center gap-1.5'>
              <StatusIcon status={value} />
              <span>{API_STATUS_LABEL[value]}</span>
            </div>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({ id: 'task.status', defaultMessage: 'Status' })}:{' '}
          {API_STATUS_LABEL[value]}
        </TooltipContent>
      </Tooltip>
      <SelectContent>
        {(Object.entries(API_STATUS_LABEL) as [ApiStatus, string][]).map(
          ([val, label]) => (
            <SelectItem key={val} value={val}>
              <div className='flex items-center gap-2'>
                <StatusIcon status={val} />
                {label}
              </div>
            </SelectItem>
          )
        )}
      </SelectContent>
    </Select>
  )
}
