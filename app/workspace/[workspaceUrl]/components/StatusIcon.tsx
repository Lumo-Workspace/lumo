'use client'

import { useIntl } from 'react-intl'

/**
 * Map a task status to the Tailwind utility that pulls the matching
 * semantic --color-status-* token. Driving the icon color through
 * `currentColor` + a className keeps StatusIcon as a pure SVG renderer
 * and lets dark mode (and any future theme) flow through automatically.
 */
const STATUS_COLOR_CLASS: Record<string, string> = {
  BACKLOG: 'text-status-todo',
  TODO: 'text-status-todo',
  IN_PROGRESS: 'text-status-in-progress',
  IN_REVIEW: 'text-status-in-review',
  DONE: 'text-status-done',
  CANCELED: 'text-muted-foreground',
}

export function StatusIcon({
  status,
  size = 14,
}: {
  status: string
  size?: number
}) {
  const intl = useIntl()
  const s = size
  const cx = s / 2
  const cy = s / 2
  const r = s * 0.393 // ~5.5 at size=14
  const colorClass = STATUS_COLOR_CLASS[status] ?? STATUS_COLOR_CLASS.TODO

  if (status === 'BACKLOG') {
    // Dashed circle — not yet scheduled (LUM-1057).
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        className={colorClass}
        aria-label={intl.formatMessage({ id: 'status.backlog' })}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke='currentColor'
          strokeWidth='1.5'
          strokeDasharray='2 2'
          fill='none'
        />
      </svg>
    )
  }

  if (status === 'IN_PROGRESS') {
    const top = `${cx},${cy - r}`
    const bottom = `${cx},${cy + r}`
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        className={colorClass}
        aria-label={intl.formatMessage({ id: 'status.inProgress' })}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke='currentColor'
          strokeWidth='1.5'
          fill='none'
        />
        <path
          d={`M ${top} A ${r} ${r} 0 0 1 ${bottom} L ${cx} ${cy} Z`}
          fill='currentColor'
        />
      </svg>
    )
  }

  if (status === 'IN_REVIEW') {
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        className={colorClass}
        aria-label={intl.formatMessage({ id: 'status.inReview' })}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke='currentColor'
          strokeWidth='1.5'
          fill='none'
        />
        <path
          d={`M ${cx},${cy} L ${cx},${cy - r} A ${r},${r} 0 1,1 ${cx - r},${cy} Z`}
          fill='currentColor'
        />
      </svg>
    )
  }

  if (status === 'DONE') {
    const cr = s * 0.43 // slightly larger for done
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        className={colorClass}
        aria-label={intl.formatMessage({ id: 'status.done' })}
      >
        <circle cx={cx} cy={cy} r={cr} fill='currentColor' />
      </svg>
    )
  }

  if (status === 'CANCELED') {
    // Circle with a cross — closed without being delivered (LUM-1282).
    const d = r * 0.5
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        className={colorClass}
        aria-label={intl.formatMessage({ id: 'status.canceled' })}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke='currentColor'
          strokeWidth='1.5'
          fill='none'
        />
        <path
          d={`M ${cx - d} ${cy - d} L ${cx + d} ${cy + d} M ${cx + d} ${cy - d} L ${cx - d} ${cy + d}`}
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
        />
      </svg>
    )
  }

  // TODO — empty circle (default)
  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill='none'
      className={colorClass}
      aria-label={intl.formatMessage({ id: 'status.todo' })}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
      />
    </svg>
  )
}
