'use client'

import { useIntl } from 'react-intl'
import { StatusIcon } from './StatusIcon'
import { STATUS_LABEL_ID } from '../utils/taskStatus'

/**
 * Semantic status indicator (LUM-263): the canonical StatusIcon + a localized
 * label. For a bare icon, use <StatusIcon> directly. Color flows from the
 * --status-* tokens through StatusIcon.
 */
export function StatusBadge({
  status,
  label,
  size = 16,
}: {
  status: string
  label?: string
  size?: number
}) {
  const intl = useIntl()
  const text =
    label ??
    intl.formatMessage({ id: STATUS_LABEL_ID[status] ?? 'status.todo' })
  return (
    <span className='inline-flex items-center gap-1.5 text-caption'>
      <StatusIcon status={status} size={size} />
      {text}
    </span>
  )
}
