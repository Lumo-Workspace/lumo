'use client'

import { useIntl } from 'react-intl'
import { Timer } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ProcessStagesModel } from './retro-view-model'
import { formatStageMedian } from './format'

interface ProcessStagesCardProps {
  /** Null when the sprint has no stored stages (closed before LUM-1280). */
  model: ProcessStagesModel | null
  /** Why `model` is null: no retro summary yet, or a summary written before
   *  stages were recorded. */
  emptyReason: 'noSummary' | 'notRecorded'
}

/**
 * Median dwell per neutral process stage, this sprint vs the previous one.
 * Calendar time; every duration is plain muted / regular text — never a
 * warning or danger tone (product ruling).
 */
export function ProcessStagesCard({
  model,
  emptyReason,
}: ProcessStagesCardProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.retro.stages.${id}` }, values)
  const median = (ms: number | null | undefined) =>
    ms === null || ms === undefined ? '—' : formatStageMedian(intl, ms)
  const compare = model?.previousName ?? null

  return (
    <Card className='min-w-0 flex-[1_1_400px]'>
      <CardHeader className='p-4 sm:p-6 sm:pb-4'>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {compare ? t('subtitle', { name: compare }) : t('subtitleNoPrev')}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col p-4 pt-0 sm:p-6 sm:pt-0'>
        {model === null ? (
          <Empty className='border border-border'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Timer />
              </EmptyMedia>
              <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
              <EmptyDescription>
                {t(
                  emptyReason === 'noSummary'
                    ? 'emptyNoSummary'
                    : 'emptyNotRecorded'
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className='hover:bg-transparent'>
                  <TableHead className='h-8 px-0 text-caption'>
                    {t('stage')}
                  </TableHead>
                  {compare && (
                    <TableHead className='h-8 w-20 px-0 text-right text-caption'>
                      {compare}
                    </TableHead>
                  )}
                  <TableHead className='h-8 w-20 px-0 text-right text-caption'>
                    {t('current')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.rows.map(row => (
                  <TableRow key={row.stage} className='hover:bg-transparent'>
                    <TableCell className='h-12 px-0'>
                      <span className='flex flex-col'>
                        <span className='text-body-strong'>
                          {t(`label.${row.stage}`)}
                        </span>
                        <span className='text-caption text-muted-foreground'>
                          {t('n', { count: row.n })}
                        </span>
                      </span>
                    </TableCell>
                    {compare && (
                      <TableCell className='px-0 text-right tabular-nums text-muted-foreground'>
                        {median(row.previousMedianMs)}
                      </TableCell>
                    )}
                    <TableCell className='px-0 text-right text-body-strong tabular-nums'>
                      {median(row.medianMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className='mt-3 text-caption text-muted-foreground'>
              {t('note')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
