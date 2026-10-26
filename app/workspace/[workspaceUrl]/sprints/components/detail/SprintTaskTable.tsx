'use client'

import { Fragment } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Item, ItemGroup, ItemSeparator } from '@/components/ui/item'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TrustBadges } from './TrustBadges'
import type { TaskRow } from './view-model'
import { formatWait } from './format'

const STATUS: Record<TaskRow['status'], { id: string; dot: string }> = {
  BACKLOG: { id: 'status.backlog', dot: 'bg-status-todo' },
  TODO: { id: 'status.todo', dot: 'bg-status-todo' },
  IN_PROGRESS: { id: 'status.inProgress', dot: 'bg-status-in-progress' },
  IN_REVIEW: { id: 'status.inReview', dot: 'bg-status-in-review' },
  DONE: { id: 'status.done', dot: 'bg-status-done' },
  // LUM-1282: muted, matching the CANCELED status icon.
  CANCELED: { id: 'status.canceled', dot: 'bg-muted-foreground' },
}

function statusOf(intl: IntlShape, row: TaskRow) {
  const s = STATUS[row.status]
  return {
    label: row.verified
      ? intl.formatMessage({ id: 'sprints.detail.status.verified' })
      : intl.formatMessage({ id: s.id }),
    dot: s.dot,
  }
}

function waitingText(intl: IntlShape, row: TaskRow): string {
  if (row.waitingOn) {
    const kind = intl.formatMessage({
      id: `sprints.detail.waiting.${row.waitingOn}`,
    })
    return row.waitingSec === null
      ? kind
      : `${kind} · ${formatWait(intl, row.waitingSec)}`
  }
  if (row.status === 'IN_PROGRESS')
    return intl.formatMessage({ id: 'sprints.detail.waiting.agent' })
  return '—'
}

function StatusChip({ label, dot }: { label: string; dot: string }) {
  return (
    <Badge variant='outline-muted' size='sm'>
      <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </Badge>
  )
}

interface SprintTaskTableProps {
  rows: TaskRow[]
  onOpenTask: (taskId: string) => void
}

/**
 * The sprint's tasks with trust, what each one is waiting on, and who
 * confirmed it done. A table from `md` up; a stacked list on phones.
 */
export function SprintTaskTable({ rows, onOpenTask }: SprintTaskTableProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.tasks.${id}` }, values)

  return (
    <section className='flex flex-col gap-3'>
      <h2 className='flex items-baseline gap-2 text-title'>
        {t('title')}
        <span className='text-caption text-muted-foreground'>
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <Empty className='border border-border'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <CheckSquare />
            </EmptyMedia>
            <EmptyTitle>
              {intl.formatMessage({ id: 'sprints.tasks.empty.title' })}
            </EmptyTitle>
            <EmptyDescription>
              {intl.formatMessage({ id: 'sprints.tasks.empty.description' })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className='hidden rounded-md border border-border md:block'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='px-4'>{t('task')}</TableHead>
                  <TableHead className='px-4'>{t('status')}</TableHead>
                  <TableHead className='px-4'>{t('trust')}</TableHead>
                  <TableHead className='px-4'>{t('waitingOn')}</TableHead>
                  <TableHead className='px-4'>{t('confirmedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const status = statusOf(intl, row)
                  return (
                    <TableRow
                      key={row.taskId}
                      className='cursor-pointer'
                      onClick={() => onOpenTask(row.taskId)}
                    >
                      <TableCell className='h-13 px-4'>
                        <button
                          type='button'
                          className='flex items-baseline gap-2.5 text-left text-body-strong'
                          onClick={e => {
                            e.stopPropagation()
                            onOpenTask(row.taskId)
                          }}
                        >
                          <code className='w-18 flex-none text-caption text-muted-foreground'>
                            {row.identifier}
                          </code>
                          {row.title}
                        </button>
                      </TableCell>
                      <TableCell className='px-4'>
                        <StatusChip {...status} />
                      </TableCell>
                      <TableCell className='px-4'>
                        <TrustBadges {...row} />
                      </TableCell>
                      <TableCell className='px-4 text-muted-foreground'>
                        {waitingText(intl, row)}
                      </TableCell>
                      <TableCell className='px-4 text-muted-foreground'>
                        {row.confirmedByName ?? '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <ItemGroup className='overflow-hidden rounded-lg border border-border md:hidden'>
            {rows.map((row, i) => {
              const status = statusOf(intl, row)
              const waiting = waitingText(intl, row)
              return (
                <Fragment key={row.taskId}>
                  {i > 0 && <ItemSeparator />}
                  <div role='listitem'>
                    <Item
                      asChild
                      size='sm'
                      className='w-full flex-col items-stretch gap-1.5 rounded-none text-left hover:bg-accent/50'
                    >
                      <button
                        type='button'
                        onClick={() => onOpenTask(row.taskId)}
                      >
                        <span className='flex items-center justify-between gap-2'>
                          <code className='text-caption text-muted-foreground'>
                            {row.identifier}
                          </code>
                          <StatusChip {...status} />
                        </span>
                        <span className='text-body-strong'>{row.title}</span>
                        <span className='flex flex-wrap items-center gap-1.5'>
                          <TrustBadges {...row} />
                          {waiting !== '—' && (
                            <span className='text-caption text-muted-foreground'>
                              {waiting}
                            </span>
                          )}
                        </span>
                      </button>
                    </Item>
                  </div>
                </Fragment>
              )
            })}
          </ItemGroup>
        </>
      )}
    </section>
  )
}
