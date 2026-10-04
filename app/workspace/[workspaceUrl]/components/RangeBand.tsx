'use client'

import type { Interval } from '@/lib/forecast/types'
import { rangeBandGeometry } from '@/lib/forecast/range-band'

// 静态区间带：灰段 = p25–p75，竖线 = 中位，圆点 = actual。纯定位无交互。
// tone='warning' 时圆点/溢出箭头转警告色（交付中 over 用），默认 info（回顾用）。
export function RangeBand({
  forecast,
  actual,
  tone = 'info',
}: {
  forecast: Interval
  actual: number
  tone?: 'info' | 'warning'
}) {
  const g = rangeBandGeometry(forecast, actual)
  const dotTone = tone === 'warning' ? 'bg-warning' : 'bg-info'
  const caretTone = tone === 'warning' ? 'text-warning-text' : 'text-info'
  return (
    <div className='relative my-3 h-1.5 rounded-full bg-muted'>
      <div
        className='absolute inset-y-0 rounded-full bg-muted-foreground/25'
        style={{ left: `${g.iqrLeft}%`, right: `${g.iqrRight}%` }}
      />
      <div
        className='absolute -top-1 h-3.5 w-0.5 rounded-sm bg-muted-foreground/50'
        style={{ left: `${g.medianPos}%` }}
      />
      {/* Overflow caret: actual is off the forecast-anchored scale; points the
          way and the deltaPct pill above carries the exact magnitude. */}
      {g.overflow === 'right' && (
        <svg
          className={`absolute top-1/2 right-0 h-2 w-2 -translate-y-1/2 ${caretTone}`}
          viewBox='0 0 8 8'
          fill='currentColor'
          aria-hidden
        >
          <path d='M2 0l4 4-4 4z' />
        </svg>
      )}
      {g.overflow === 'left' && (
        <svg
          className={`absolute top-1/2 left-0 h-2 w-2 -translate-y-1/2 ${caretTone}`}
          viewBox='0 0 8 8'
          fill='currentColor'
          aria-hidden
        >
          <path d='M6 0L2 4l4 4z' />
        </svg>
      )}
      <div
        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${dotTone}`}
        style={{ left: `${g.actualPos}%` }}
      />
    </div>
  )
}
