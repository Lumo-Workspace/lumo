'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import { MIN_BASELINE_SAMPLE, type BaselineStat } from '@/lib/baseline/types'
import { VariancePill } from '@/components/VariancePill'

/**
 * 报告指标的统一「当前 vs 参照类」呈现。诚实三态:
 *   base=null → 「暂无基线」;sampleSize<MIN → 「基线样本不足」;current=null → 当前显 —。
 * 复用 VariancePill 淡色偏差语法,保持全库一致。值/基线口径由调用方注入。
 */
export function BaselineStatView({
  stat,
  formatValue,
  baseLabel,
  valueClassName,
}: {
  stat: BaselineStat
  formatValue: (n: number) => string
  baseLabel: string
  valueClassName?: string
}) {
  const intl = useIntl()
  const currentText = stat.current !== null ? formatValue(stat.current) : '—'
  const hasBase = stat.base !== null
  const insufficient = hasBase && stat.sampleSize < MIN_BASELINE_SAMPLE

  return (
    <div className='flex flex-col gap-0.5'>
      <span
        className={cn('tabular-nums', valueClassName ?? 'text-body-strong')}
      >
        {currentText}
      </span>
      {!hasBase ? (
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'baseline.none' })}
        </span>
      ) : insufficient ? (
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'baseline.insufficient' })}
        </span>
      ) : (
        <span className='flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground'>
          <span>
            {intl.formatMessage({ id: baseLabel })}{' '}
            <span className='tabular-nums'>
              {formatValue(stat.base as number)}
            </span>
          </span>
          <VariancePill
            band={stat.band}
            deltaPct={stat.deltaPct}
            deltaKind={stat.deltaKind}
          />
        </span>
      )}
    </div>
  )
}
