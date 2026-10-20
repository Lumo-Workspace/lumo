'use client'

import { useIntl } from 'react-intl'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { CarriedOverRow } from './retro-view-model'

interface CarriedOverCardProps {
  /** Stored spillover count (`stats.spillover`); null = no summary yet. */
  count: number | null
  /** The summary read failed (vs. not generated yet) when `count` is null. */
  readFailed: boolean
  /** The carried-over tasks with where each went; null = not readable, so
   *  the card shows the count alone. */
  rows: CarriedOverRow[] | null
  onOpenTask: (taskId: string, identifier: string) => void
}

/**
 * Tasks that left the sprint at close, and where each one went. A table from
 * `md` up; a stacked list on phones.
 */
export function CarriedOverCard({
  readFailed,
  count,
  rows,
  onOpenTask,
}: CarriedOverCardProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.retro.carried.${id}` }, values)

  return (
    <Card className='min-w-0 flex-[999_1_640px]'>
      <CardHeader className='p-4 sm:p-6 sm:pb-4'>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {count !== null
            ? t('subtitle', { count })
            : readFailed
              ? intl.formatMessage({
                  id: 'sprints.detail.retro.summary.readError',
                })
              : t('pending')}
        </CardDescription>
      </CardHeader>
      {rows && rows.length > 0 && (
        <CardContent className='p-4 pt-0 sm:p-6 sm:pt-0'>
          <div className='hidden rounded-md border md:block'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('task')}</TableHead>
                  <TableHead className='w-40'>{t('destination')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow
                    key={r.taskId}
                    className='h-12 cursor-pointer'
                    onClick={() => onOpenTask(r.taskId, r.identifier)}
                  >
                    <TableCell>
                      <button
                        type='button'
                        className='flex items-baseline gap-2.5 text-left text-body-strong'
                        onClick={e => {
                          e.stopPropagation()
                          onOpenTask(r.taskId, r.identifier)
                        }}
                      >
                        <code className='w-18 flex-none text-caption text-muted-foreground'>
                          {r.identifier}
                        </code>
                        {r.title}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' size='sm'>
                        {r.destination ?? t('backlog')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Phones: a stacked list, so where each task went stays visible. */}
          <ul className='overflow-hidden rounded-lg border md:hidden'>
            {rows.map(r => (
              <li key={r.taskId} className='border-b last:border-b-0'>
                <button
                  type='button'
                  onClick={() => onOpenTask(r.taskId, r.identifier)}
                  className='flex w-full flex-col gap-1.5 px-4 py-3 text-left'
                >
                  <span className='flex items-center justify-between gap-2'>
                    <code className='text-caption text-muted-foreground'>
                      {r.identifier}
                    </code>
                    <Badge variant='outline' size='sm'>
                      {r.destination ?? t('backlog')}
                    </Badge>
                  </span>
                  <span className='text-body-strong'>{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  )
}
