'use client'

import { useIntl } from 'react-intl'
import { StatusIcon } from './StatusIcon'

/** react-intl message ids for task-status labels (keys already exist in all
 *  16 locales — also used by <StatusIcon> aria-labels). */
const STATUS_LABEL_ID: Record<string, string> = {
  BACKLOG: 'status.backlog',
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
}

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
