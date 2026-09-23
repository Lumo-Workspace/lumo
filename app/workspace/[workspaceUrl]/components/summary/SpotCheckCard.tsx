'use client'

import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import type { FalseReportRate } from '@/lib/test-cases/review'
import { RateReadout } from '../pages/RunReviewView'

interface SpotCheckCardProps {
  rate: FalseReportRate
  /** 还有多少条报了 PASS、有证据、没人看过。 */
  poolSize: number
  onOpen: () => void
}

/**
 * LUM-819 返工：抽查的入口。
 *
 * 抽查是低频的质检动作（一周抽一批），不是每天的工作流，所以不占侧边栏一级
 * 入口；放在 Dashboard 上，因为大家真正关心的是那个比率，列表只是得到它的
 * 手段。读数照旧带分子分母、样本不足不给百分比（同 RateReadout）。
 */
export function SpotCheckCard({ rate, poolSize, onOpen }: SpotCheckCardProps) {
  const intl = useIntl()
  return (
    <section className='flex flex-col gap-3 rounded-lg border border-border bg-muted p-4'>
      <RateReadout rate={rate} />
      <div className='flex flex-wrap items-center gap-3'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'dashboard.spotCheck.pool' }, { poolSize })}
        </p>
        <span className='flex-1' />
        <Button size='sm' variant='outline' onClick={onOpen}>
          {intl.formatMessage({ id: 'dashboard.spotCheck.open' })}
        </Button>
      </div>
    </section>
  )
}
