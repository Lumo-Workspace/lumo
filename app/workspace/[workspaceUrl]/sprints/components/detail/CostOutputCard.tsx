'use client'

import { useIntl } from 'react-intl'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { fmtCompact } from '../../../components/AgentRunTimeline/model-cost-format'

export interface ReworkRow {
  taskId: string
  identifier: string
  title: string
  reopens: number
  reverts: number
}

interface CostOutputCardProps {
  tokensPerVerifiedTask: number | null
  previousTokensPerVerifiedTask: number | null
  reworkShare: number | null
  reworkTop: ReworkRow[]
  onOpenTask: (taskId: string) => void
}

/** Tokens per verified task (vs the previous sprint), rework share, top rework. */
export function CostOutputCard({
  tokensPerVerifiedTask,
  previousTokensPerVerifiedTask,
  reworkShare,
  reworkTop,
  onOpenTask,
}: CostOutputCardProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.cost.${id}` }, values)

  return (
    <Card>
      <CardHeader className='p-4 sm:p-6 sm:pb-4'>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4 p-4 pt-0 sm:p-6 sm:pt-0'>
        <div className='grid grid-cols-2 gap-4'>
          <div className='flex flex-col gap-0.5'>
            <span className='text-caption text-muted-foreground'>
              {t('perVerified')}
            </span>
            <span className='text-heading tabular-nums'>
              {tokensPerVerifiedTask === null
                ? '—'
                : fmtCompact(intl, tokensPerVerifiedTask)}
            </span>
            {previousTokensPerVerifiedTask !== null && (
              <span className='text-caption text-muted-foreground'>
                {t('previous', {
                  value: fmtCompact(intl, previousTokensPerVerifiedTask),
                })}
              </span>
            )}
          </div>
          <div className='flex flex-col gap-0.5'>
            <span className='text-caption text-muted-foreground'>
              {t('reworkShare')}
            </span>
            <span className='text-heading tabular-nums'>
              {reworkShare === null
                ? '—'
                : intl.formatNumber(reworkShare, { style: 'percent' })}
            </span>
            <span className='text-caption text-muted-foreground'>
              {t('reworkHint')}
            </span>
          </div>
        </div>
        {reworkTop.length > 0 && (
          <>
            <Separator />
            <ul className='flex flex-col'>
              {reworkTop.map(r => {
                const why: string[] = []
                if (r.reopens > 0) why.push(t('reopened', { count: r.reopens }))
                if (r.reverts > 0) why.push(t('reverted', { count: r.reverts }))
                return (
                  <li key={r.taskId}>
                    <button
                      type='button'
                      onClick={() => onOpenTask(r.taskId)}
                      className='flex h-9 w-full items-center gap-2.5 rounded-sm text-left text-body hover:bg-muted/50'
                    >
                      <code className='flex-none text-caption text-muted-foreground'>
                        {r.identifier}
                      </code>
                      <span className='min-w-0 flex-1 truncate'>{r.title}</span>
                      <span className='flex-none text-caption text-muted-foreground'>
                        {why.join(' · ')}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
