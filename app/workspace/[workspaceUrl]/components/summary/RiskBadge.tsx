'use client'

import { useIntl } from 'react-intl'
import type { RiskLevel } from '@/types/summary'

interface RiskBadgeProps {
  level: RiskLevel | null
  size?: 'sm' | 'md'
  showLabel?: boolean
}

// Maps to the semantic feedback tokens (LUM-258/LUM-290), mirroring the callout
// pattern: -subtle tint + -border border + accent dot. The label stays
// text-foreground because the bright accents fail AA as text on their own
// -subtle tint (~2:1) — color is carried by the dot / tint / border, which is
// accessible. -subtle / -border are translucent color-mix, so a single class
// adapts to dark with no `dark:` variant.
const STYLES: Record<
  RiskLevel | 'null',
  { dot: string; bg: string; border: string; text: string; labelKey: string }
> = {
  healthy: {
    dot: 'bg-success',
    bg: 'bg-success-subtle',
    border: 'border border-success-border',
    text: 'text-foreground',
    labelKey: 'summary.riskLevel.healthy',
  },
  watch: {
    dot: 'bg-warning',
    bg: 'bg-warning-subtle',
    border: 'border border-warning-border',
    text: 'text-foreground',
    labelKey: 'summary.riskLevel.watch',
  },
  'at-risk': {
    dot: 'bg-danger',
    bg: 'bg-danger-subtle',
    border: 'border border-danger-border',
    text: 'text-foreground',
    labelKey: 'summary.riskLevel.atRisk',
  },
  null: {
    dot: 'bg-muted-foreground',
    bg: 'bg-transparent',
    border: '',
    text: 'text-muted-foreground',
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
      className={`inline-flex items-center gap-1.5 rounded-full ${padding} ${style.bg} ${style.border}`}
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
