'use client'

import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { ApiProjectStatus } from '../../types'

/** LUM-1285: the three human rulings, in the order the picker lists them. */
export const PROJECT_STATUS_OPTIONS: readonly ApiProjectStatus[] = [
  'ACTIVE',
  'PAUSED',
  'CANCELED',
]

export const PROJECT_STATUS_LABEL_ID: Record<ApiProjectStatus, string> = {
  ACTIVE: 'project.status.active',
  PAUSED: 'project.status.paused',
  CANCELED: 'project.status.canceled',
}

export interface ProjectStatusSelectProps {
  value: ApiProjectStatus
  onChange: (v: ApiProjectStatus) => void
  disabled?: boolean | undefined
  triggerClassName?: string | undefined
}

/**
 * Picks a project's status (LUM-1285). There is no "completed" option —
 * completion is derived from the tasks and shown beside this control.
 */
export function ProjectStatusSelect({
  value,
  onChange,
  disabled,
  triggerClassName,
}: ProjectStatusSelectProps) {
  const intl = useIntl()
  return (
    <Select
      value={value}
      disabled={disabled ?? false}
      onValueChange={v => onChange(v as ApiProjectStatus)}
    >
      <SelectTrigger
        className={triggerClassName}
        aria-label={intl.formatMessage({ id: 'project.status.label' })}
      >
        <span>
          {intl.formatMessage({ id: PROJECT_STATUS_LABEL_ID[value] })}
        </span>
      </SelectTrigger>
      <SelectContent>
        {PROJECT_STATUS_OPTIONS.map(s => (
          <SelectItem key={s} value={s}>
            {intl.formatMessage({ id: PROJECT_STATUS_LABEL_ID[s] })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
