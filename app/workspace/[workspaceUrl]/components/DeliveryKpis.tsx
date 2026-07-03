'use client'

import { useIntl } from 'react-intl'
import { formatDurationMs } from '@/lib/datetime/duration'
import { BaselineStatView } from '@/components/BaselineStat'
import type { BaselineStat } from '@/lib/baseline/types'

/**
 * 交付卡底部 KPI 块:运行次数 / 交互轮次 / 运行时长,每项带参照类基线。
 * 进行中与已交付共用(LUM-524)。时长以秒计,formatValue 内转 ms 显示。
 */
export function DeliveryKpis({
  runs,
  interactionRounds,
  duration,
}: {
  runs: BaselineStat
  interactionRounds: BaselineStat
  duration: BaselineStat
}) {
  const intl = useIntl()
  const fmtCount = (n: number) => String(Math.round(n))
  const fmtDuration = (sec: number) => formatDurationMs(intl, sec * 1000)

  return (
    <div className='mt-4 border-t border-border pt-3'>
      <p className='mb-2 text-caption text-muted-foreground'>
        {intl.formatMessage({ id: 'retrospective.delivery' })}
      </p>
      <div className='flex flex-wrap gap-x-8 gap-y-2'>
        <div className='flex flex-col'>
          <span className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'retrospective.iterations' })}
          </span>
          <BaselineStatView
            stat={runs}
            formatValue={fmtCount}
            baseLabel='baseline.median'
          />
        </div>
        <div className='flex flex-col'>
          <span className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'retrospective.interactionRounds' })}
          </span>
          <BaselineStatView
            stat={interactionRounds}
            formatValue={fmtCount}
            baseLabel='baseline.median'
          />
        </div>
        <div className='flex flex-col'>
          <span className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'retrospective.totalDuration' })}
          </span>
          <BaselineStatView
            stat={duration}
            formatValue={fmtDuration}
            baseLabel='baseline.median'
          />
        </div>
      </div>
    </div>
  )
}
