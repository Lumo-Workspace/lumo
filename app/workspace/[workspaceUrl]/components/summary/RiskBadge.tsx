'use client'

import { useIntl } from 'react-intl'
import type { RiskLevel } from '@/types/summary'

interface RiskBadgeProps {
  level: RiskLevel | null
  size?: 'sm' | 'md'
  showLabel?: boolean
}

const STYLES: Record<
  RiskLevel | 'null',
  { dot: string; bg: string; text: string; labelKey: string }
> = {
  healthy: {
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    labelKey: 'summary.riskLevel.healthy',
  },
  watch: {
    dot: 'bg-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
    labelKey: 'summary.riskLevel.watch',
  },
  'at-risk': {
    dot: 'bg-red-500',
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    labelKey: 'summary.riskLevel.atRisk',
  },
  null: {
    dot: 'bg-zinc-400',
    bg: 'bg-transparent',
    text: 'text-zinc-500 dark:text-zinc-400',
    labelKey: 'summary.riskLevel.unassessed',
  },
}

export function RiskBadge({
  level,
  size = 'md',
  showLabel = true,
}: RiskBadgeProps) {
  const intl = useIntl()
  const style = STYLES[level ?? 'null']
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${padding} ${style.bg}`}
    >
      <span className={`${dotSize} rounded-full ${style.dot}`} aria-hidden />
      {showLabel && (
        <span className={`text-xs font-medium ${style.text}`}>
          {intl.formatMessage({ id: style.labelKey })}
        </span>
      )}
    </span>
  )
}
