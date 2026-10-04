'use client'

import { useIntl } from 'react-intl'
import { AlertTriangle, GitFork } from 'lucide-react'
import { useDependencies } from '../../hooks/useDependencies'
import { groupDependencies, computeLiveBlockers } from '../groupDependencies'
import { DependencyRow } from './DependencyRow'
import { AddDependencyButton } from './AddDependencyButton'
import type { DependencyEdge } from '../types'

interface DependenciesSectionProps {
  /** LUM-N identifier — the API route's resolveTask accepts it directly. */
  taskIdentifier: string
  /** Rendered inside a dialog: drop the main-column margin + own title. */
  embedded?: boolean
}

function Group({
  titleId,
  edges,
  onRemove,
  busy,
}: {
  titleId: string
  edges: DependencyEdge[]
  onRemove: (id: string) => void
  busy: boolean
}) {
  const intl = useIntl()
  if (edges.length === 0) return null
  return (
    <div className='mt-3'>
      <p className='text-xs font-medium text-muted-foreground mb-1'>
        {intl.formatMessage({ id: titleId })}
      </p>
      {edges.map(e => (
        <DependencyRow
          key={e.id}
          edge={e}
          variant='confirmed'
          busy={busy}
          onRemove={() => onRemove(e.id)}
        />
      ))}
    </div>
  )
}

export function DependenciesSection({
  taskIdentifier,
  embedded = false,
}: DependenciesSectionProps) {
  const intl = useIntl()
  const { edges, loading, add, patch, remove } = useDependencies({
    taskId: taskIdentifier,
  })
  const grouped = groupDependencies(edges)
  const existingRelations = new Set(
    edges
      .filter(e => e.status === 'CONFIRMED')
      .map(e =>
        e.kind === 'RELATES'
          ? `RELATES:${e.other.identifier}`
          : `${e.direction}:${e.other.identifier}`
      )
  )
  const liveBlockers = computeLiveBlockers(edges)
  const busy = add.isPending || patch.isPending || remove.isPending
  const isEmpty = edges.filter(e => e.status !== 'DISMISSED').length === 0
  const mutationError =
    (add.isError ? (add.error as Error | null)?.message : null) ??
    (patch.isError ? (patch.error as Error | null)?.message : null) ??
    (remove.isError ? (remove.error as Error | null)?.message : null) ??
    null

  return (
    <section className={embedded ? 'min-w-0' : 'mt-6'}>
      <div
        className={`flex items-center mb-1 ${
          embedded ? 'justify-end' : 'justify-between'
        }`}
      >
        {!embedded && (
          <h3 className='text-sm font-medium flex items-center gap-1.5'>
            <GitFork className='h-4 w-4' />
            {intl.formatMessage({ id: 'task.dependencies.title' })}
          </h3>
        )}
        <AddDependencyButton
          currentIdentifier={taskIdentifier}
          existingRelations={existingRelations}
          busy={busy}
          onAdd={data => add.mutate(data)}
        />
      </div>

      {liveBlockers.length > 0 && (
        <div className='flex items-center gap-2 rounded-md bg-destructive/10 text-danger-text px-3 py-2 text-sm mb-2'>
          <AlertTriangle className='h-4 w-4' />
          {intl.formatMessage(
            { id: 'task.dependencies.blockedAlert' },
            {
              count: liveBlockers.length,
              first: liveBlockers[0]!.other.identifier,
            }
          )}
        </div>
      )}

      {mutationError !== null && (
        <p className='text-xs text-danger-text mt-1'>
          {mutationError ||
            intl.formatMessage({ id: 'task.dependencies.actionFailed' })}
        </p>
      )}

      {loading && (
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'task.dependencies.loading' })}
        </p>
      )}

      {!loading && isEmpty && (
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'task.dependencies.empty' })}
        </p>
      )}

      <Group
        titleId='task.dependencies.blockedBy'
        edges={grouped.blockedBy}
        busy={busy}
        onRemove={id => remove.mutate(id)}
      />
      <Group
        titleId='task.dependencies.blocks'
        edges={grouped.blocks}
        busy={busy}
        onRemove={id => remove.mutate(id)}
      />
      <Group
        titleId='task.dependencies.related'
        edges={grouped.related}
        busy={busy}
        onRemove={id => remove.mutate(id)}
      />

      {grouped.suggested.length > 0 && (
        <div className='mt-3 rounded-md bg-muted/50 p-2'>
          <p className='text-xs font-medium text-muted-foreground mb-1'>
            {intl.formatMessage(
              { id: 'task.dependencies.suggested' },
              { count: grouped.suggested.length }
            )}
          </p>
          {grouped.suggested.map(e => (
            <DependencyRow
              key={e.id}
              edge={e}
              variant='suggested'
              busy={busy}
              onConfirm={reverse =>
                patch.mutate({ depId: e.id, action: 'confirm', reverse })
              }
              onDismiss={() => patch.mutate({ depId: e.id, action: 'dismiss' })}
            />
          ))}
        </div>
      )}
    </section>
  )
}
