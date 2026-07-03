'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client'

type Topology = NonNullable<ApiMilestone['topology']>

const STATUS_LABEL_ID: Record<string, string> = {
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
}

interface MilestoneTopologySectionProps {
  topology: ApiMilestone['topology']
  workspaceUrl: string
}

/**
 * LUM-645 "next up" — the dependency-ordered execution plan: which open
 * tasks are ready right now (every confirmed blocker DONE), ranked by how
 * many open tasks finishing them releases, plus the unweighted critical
 * path. Honest by construction: a dependency cycle is reported explicitly,
 * a topology without confirmed edges says so instead of faking an order.
 */
export function MilestoneTopologySection({
  topology,
  workspaceUrl,
}: MilestoneTopologySectionProps) {
  const intl = useIntl()
  if (!topology) return null
  const tp: Topology = topology
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values)
  const taskHref = (ref: string) => `/workspace/${workspaceUrl}/my-tasks/${ref}`
  // Unknown future statuses show raw rather than lying "Todo".
  const statusLabel = (s: string) => {
    const id = STATUS_LABEL_ID[s]
    return id ? t(id) : s
  }

  const openCount = tp.nextBatch.length + tp.blockedOpenCount
  const empty =
    tp.edgeCount === 0 ? (
      <div className='rounded-lg border px-4 py-4 text-sm text-muted-foreground'>
        <p className='mb-0.5 font-semibold text-foreground'>
          {t('milestone.topology.empty.noEdges.title')}
        </p>
        {t('milestone.topology.empty.noEdges.body')}
      </div>
    ) : tp.nextBatch.length === 0 ? (
      <div className='rounded-lg border px-4 py-4 text-sm text-muted-foreground'>
        <p className='mb-0.5 font-semibold text-foreground'>
          {openCount === 0
            ? t('milestone.topology.empty.done.title')
            : t('milestone.topology.empty.noneReady.title')}
        </p>
        {openCount === 0
          ? t('milestone.topology.empty.done.body')
          : t('milestone.topology.empty.noneReady.body')}
      </div>
    ) : null

  const batchRow = (b: Topology['nextBatch'][number]) => {
    const metaParts: string[] = []
    if (b.unblocksCount > 0)
      metaParts.push(
        t('milestone.topology.batch.unblocks', { count: b.unblocksCount })
      )
    if (b.onCriticalPath) metaParts.push(t('milestone.topology.batch.critical'))
    if (b.status !== 'TODO') metaParts.push(statusLabel(b.status))
    return (
      <Link
        key={b.taskId}
        href={taskHref(b.ref)}
        className='grid grid-cols-[72px_1fr_auto_16px] items-baseline gap-3 px-3 py-2 hover:bg-muted'
      >
        <span className='font-mono text-xs text-muted-foreground'>{b.ref}</span>
        <span className='truncate text-[13.5px] font-medium'>{b.title}</span>
        <span className='whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
          {metaParts.join(' · ')}
        </span>
        <span
          aria-hidden='true'
          className='justify-self-end self-center text-xs text-muted-foreground'
        >
          ›
        </span>
      </Link>
    )
  }

  return (
    <section className='mb-10' aria-label={t('milestone.topology.title')}>
      <div className='mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <h2 className='text-base font-bold'>{t('milestone.topology.title')}</h2>
        <span className='text-xs text-muted-foreground'>
          {t('milestone.topology.subtitle')}
        </span>
      </div>

      {tp.cycleRefs.length > 0 && (
        <div className='mb-4 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground'>
          <span className='font-semibold text-foreground'>
            {t('milestone.topology.cycle.title')}
          </span>{' '}
          {t('milestone.topology.cycle.body', {
            refs: tp.cycleRefs.join(' ↔ '),
          })}
        </div>
      )}

      {empty ?? (
        <div>
          <h3 className='mb-2 flex items-baseline gap-2 text-sm font-semibold'>
            {t('milestone.topology.batch.title')}
            <span className='text-xs font-normal tabular-nums text-muted-foreground'>
              {t('milestone.topology.batch.count', {
                count: tp.nextBatch.length,
              })}
              {tp.blockedOpenCount > 0 && (
                <>
                  {' · '}
                  {t('milestone.topology.batch.stillBlocked', {
                    count: tp.blockedOpenCount,
                  })}
                </>
              )}
            </span>
          </h3>
          <div className='divide-y divide-border rounded-lg border'>
            {tp.nextBatch.map(batchRow)}
          </div>
        </div>
      )}

      {tp.criticalPath.length > 0 && (
        <p className='mt-5 border-t pt-3.5 text-xs text-muted-foreground'>
          <span className='font-semibold text-foreground'>
            {t('milestone.topology.criticalPath.label')}
          </span>{' '}
          <span className='font-mono'>
            {tp.criticalPath
              .map(n => (n.status === 'DONE' ? `${n.ref} ✓` : n.ref))
              .join(' → ')}
          </span>{' '}
          <span className='tabular-nums'>
            {t('milestone.topology.criticalPath.depth', {
              levels: tp.levels.length,
              length: tp.criticalPath.length,
            })}
          </span>
        </p>
      )}
    </section>
  )
}
