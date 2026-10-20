'use client'

import { useIntl } from 'react-intl'
import { Inbox } from 'lucide-react'
import type { SprintAttentionScope } from '@/lib/api-client/sprints'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { QueueKindSummary, QueueRow } from './view-model'
import { formatWait } from './format'

const KIND_KEY: Record<QueueRow['kind'], string> = {
  prReview: 'sprints.detail.queue.kind.prReview',
  crossingRuling: 'sprints.detail.queue.kind.crossingRuling',
  doneConfirmation: 'sprints.detail.queue.kind.doneConfirmation',
}

const ACTION_KEY: Record<QueueRow['kind'], string> = {
  prReview: 'sprints.detail.queue.action.review',
  crossingRuling: 'sprints.detail.queue.action.rule',
  doneConfirmation: 'sprints.detail.queue.action.confirmDone',
}

interface AwaitingPeopleCardProps {
  scope: SprintAttentionScope
  onScopeChange: (scope: SprintAttentionScope) => void
  rows: QueueRow[]
  /** Team tab only: count + longest wait per kind. */
  kinds: QueueKindSummary[]
  loading: boolean
  onOpenTask: (taskId: string) => void
}

function QueueDetail({ row }: { row: QueueRow }) {
  const intl = useIntl()
  const parts: string[] = []
  if (row.prNumber !== null)
    parts.push(
      intl.formatMessage(
        { id: 'sprints.detail.queue.pr' },
        { number: row.prNumber }
      )
    )
  if (row.crossingCategory) parts.push(row.crossingCategory)
  if (row.testsTotal !== null && row.kind !== 'crossingRuling')
    parts.push(
      row.testsTotal === 0
        ? intl.formatMessage({ id: 'sprints.detail.trust.noTc' })
        : intl.formatMessage(
            { id: 'sprints.detail.trust.tc' },
            { passing: row.testsPassing ?? 0, total: row.testsTotal }
          )
    )
  if (parts.length === 0) return null
  return (
    <span className='text-caption text-muted-foreground'>
      {parts.join(' · ')}
    </span>
  )
}

function QueueAction({
  row,
  onOpenTask,
}: {
  row: QueueRow
  onOpenTask: (taskId: string) => void
}) {
  const intl = useIntl()
  const label = intl.formatMessage({ id: ACTION_KEY[row.kind] })
  const className = 'h-11 w-full sm:h-8 sm:w-auto sm:min-w-21'
  if (row.kind === 'prReview' && row.prUrl)
    return (
      <Button variant='outline' size='sm' className={className} asChild>
        <a href={row.prUrl} target='_blank' rel='noreferrer'>
          {label}
        </a>
      </Button>
    )
  return (
    <Button
      variant='outline'
      size='sm'
      className={className}
      onClick={() => onOpenTask(row.taskId)}
    >
      {label}
    </Button>
  )
}

/** "Mine": one row per wait with its action; stacked on phones. */
function MineRow({
  row,
  onOpenTask,
}: {
  row: QueueRow
  onOpenTask: (taskId: string) => void
}) {
  const intl = useIntl()
  return (
    <li className='flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:min-h-14 sm:flex-row sm:items-center sm:gap-4 sm:py-2'>
      <div className='flex items-center justify-between gap-2 sm:w-32 sm:flex-none'>
        <Badge variant='muted' size='sm'>
          {intl.formatMessage({ id: KIND_KEY[row.kind] })}
        </Badge>
        <span className='text-body text-muted-foreground tabular-nums sm:hidden'>
          {formatWait(intl, row.waitingSec)}
        </span>
      </div>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2.5'>
          <code className='text-caption text-muted-foreground'>
            {row.identifier}
          </code>
          <span className='truncate text-body-strong'>{row.title}</span>
        </span>
        <QueueDetail row={row} />
      </div>
      <span className='hidden w-22 flex-none text-right text-body text-muted-foreground tabular-nums sm:block'>
        {formatWait(intl, row.waitingSec)}
      </span>
      <div className='sm:flex-none'>
        <QueueAction row={row} onOpenTask={onOpenTask} />
      </div>
    </li>
  )
}

/** "Team": who owns each wait and for how long; the row opens the task. */
function TeamRow({
  row,
  onOpenTask,
}: {
  row: QueueRow
  onOpenTask: (taskId: string) => void
}) {
  const intl = useIntl()
  return (
    <li className='border-b border-border last:border-b-0'>
      <button
        type='button'
        onClick={() => onOpenTask(row.taskId)}
        className='flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50 sm:min-h-12 sm:flex-row sm:items-center sm:gap-4 sm:py-2'
      >
        <span className='flex items-center justify-between gap-2 sm:w-32 sm:flex-none'>
          <Badge variant='muted' size='sm'>
            {intl.formatMessage({ id: KIND_KEY[row.kind] })}
          </Badge>
          <span className='text-body text-muted-foreground tabular-nums sm:hidden'>
            {formatWait(intl, row.waitingSec)}
          </span>
        </span>
        <code className='text-caption text-muted-foreground sm:w-20 sm:flex-none'>
          {row.identifier}
        </code>
        <span className='min-w-0 flex-1 truncate text-body-strong'>
          {row.title}
        </span>
        <span className='text-caption text-muted-foreground sm:w-28 sm:flex-none'>
          {intl.formatMessage(
            { id: 'sprints.detail.queue.owner' },
            {
              name:
                row.ownerName ??
                intl.formatMessage({ id: 'sprints.detail.queue.noOwner' }),
            }
          )}
        </span>
        <span className='hidden w-20 flex-none text-right text-body text-muted-foreground tabular-nums sm:block'>
          {formatWait(intl, row.waitingSec)}
        </span>
      </button>
    </li>
  )
}

/**
 * Collaborative waits only — PR review, crossing ruling, DONE confirmation.
 * Ordered oldest first by the server; waits are muted text, never red: urgency
 * comes from the order alone. PR review appears only on the team tab, owned by
 * the task's assignee (requested reviewers aren't stored).
 */
export function AwaitingPeopleCard({
  scope,
  onScopeChange,
  rows,
  kinds,
  loading,
  onOpenTask,
}: AwaitingPeopleCardProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `sprints.detail.queue.${id}` }, values)

  return (
    <Card>
      <CardHeader className='flex-row flex-wrap items-start justify-between gap-3 space-y-0 p-4 sm:p-6 sm:pb-4'>
        <div className='flex flex-col gap-1.5'>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {scope === 'mine'
              ? t('subtitleMine', { count: rows.length })
              : t('subtitleTeam', { count: rows.length })}
          </CardDescription>
        </div>
        <Tabs
          value={scope}
          onValueChange={v => onScopeChange(v as SprintAttentionScope)}
        >
          <TabsList aria-label={t('scope')}>
            <TabsTrigger value='mine'>{t('mine')}</TabsTrigger>
            <TabsTrigger value='team'>{t('team')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className='flex flex-col gap-3 p-0 sm:p-6 sm:pt-0'>
        {loading ? (
          <div className='flex flex-col gap-2 px-4 pb-4 sm:p-0'>
            <Skeleton className='h-14 w-full' />
            <Skeleton className='h-14 w-full' />
          </div>
        ) : rows.length === 0 ? (
          <Empty className='border-t border-border sm:rounded-md sm:border'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
              <EmptyDescription>
                {scope === 'mine' ? t('emptyMine') : t('emptyTeam')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {scope === 'team' && (
              <div className='grid grid-cols-3 gap-2 px-4 sm:gap-3 sm:px-0'>
                {kinds.map(k => (
                  <div
                    key={k.kind}
                    className='flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 sm:px-4 sm:py-3'
                  >
                    <span className='text-caption text-muted-foreground'>
                      {intl.formatMessage({ id: KIND_KEY[k.kind] })}
                    </span>
                    <span className='flex flex-wrap items-baseline gap-x-2'>
                      <span className='text-heading tabular-nums'>
                        {k.count}
                      </span>
                      {k.oldestSec !== null && (
                        <span className='text-caption text-muted-foreground'>
                          {t('oldest', {
                            wait: formatWait(intl, k.oldestSec),
                          })}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <ul className='overflow-hidden border-t border-border sm:rounded-md sm:border'>
              {rows.map(row =>
                scope === 'mine' ? (
                  <MineRow key={row.key} row={row} onOpenTask={onOpenTask} />
                ) : (
                  <TeamRow key={row.key} row={row} onOpenTask={onOpenTask} />
                )
              )}
            </ul>
            {scope === 'team' && (
              <p className='px-4 pb-4 text-caption text-muted-foreground sm:p-0'>
                {t('ownerNote')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
