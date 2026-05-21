'use client'

import { useIntl } from 'react-intl'

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

  if (status === 'IN_PROGRESS') {
    // Left half filled, right half stroke-only
    const top = `${cx},${cy - r}`
    const bottom = `${cx},${cy + r}`
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        aria-label={intl.formatMessage({ id: 'status.inProgress' })}
      >
        {/* Outer ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke='#3b82f6'
          strokeWidth='1.5'
          fill='none'
        />
        {/* Left half fill (clockwise arc from top to bottom on the right side) */}
        <path
          d={`M ${top} A ${r} ${r} 0 0 1 ${bottom} L ${cx} ${cy} Z`}
          fill='#3b82f6'
        />
      </svg>
    )
  }

  if (status === 'IN_REVIEW') {
    // Outer ring + 3/4 filled sector inside (gap at top-left)
    // From top (cx, cy-r) clockwise 270° to left (cx-r, cy), then back to center
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        aria-label={intl.formatMessage({ id: 'status.inReview' })}
      >
        {/* Outer ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke='#8b5cf6'
          strokeWidth='1.5'
          fill='none'
        />
        {/* 3/4 filled sector */}
        <path
          d={`M ${cx},${cy} L ${cx},${cy - r} A ${r},${r} 0 1,1 ${cx - r},${cy} Z`}
          fill='#8b5cf6'
        />
      </svg>
    )
  }

  if (status === 'DONE') {
    // Filled circle + white checkmark
    const cr = s * 0.43 // slightly larger for done
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        aria-label={intl.formatMessage({ id: 'status.done' })}
      >
        <circle cx={cx} cy={cy} r={cr} fill='#10b981' />
        <path
          d={`M ${s * 0.29} ${cy} L ${s * 0.43} ${s * 0.64} L ${s * 0.71} ${s * 0.36}`}
          stroke='white'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          fill='none'
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
      aria-label={intl.formatMessage({ id: 'status.todo' })}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke='#a1a1aa'
        strokeWidth='1.5'
        fill='none'
      />
    </svg>
  )
}
