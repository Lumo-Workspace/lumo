export function StatusIcon({
  status,
  size = 14,
}: {
  status: string
  size?: number
}) {
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
        aria-label='In Progress'
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
    // Circle outline + clockwise arrow inside
    const ar = r * 0.55 // inner arrow radius
    return (
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill='none'
        aria-label='In Review'
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
        {/* 3/4 arc clockwise starting from top-right */}
        <path
          d={`M ${cx + ar * 0.707},${cy - ar * 0.707} A ${ar} ${ar} 0 1 1 ${cx - ar},${cy}`}
          stroke='#8b5cf6'
          strokeWidth='1.5'
          strokeLinecap='round'
          fill='none'
        />
        {/* Arrowhead at end of arc (pointing roughly down-left) */}
        <polyline
          points={`${cx - ar + ar * 0.55},${cy - ar * 0.4} ${cx - ar},${cy} ${cx - ar * 0.4},${cy + ar * 0.55}`}
          stroke='#8b5cf6'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          fill='none'
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
        aria-label='Done'
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
      aria-label='Todo'
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
