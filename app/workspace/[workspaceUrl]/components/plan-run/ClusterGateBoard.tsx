'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ApiClientError,
  planRunsClient,
  type ClusterGateIdea,
  type ClusterGateView,
} from '@/lib/api-client'
import type { ClusterGateCluster } from '@/lib/plan-run/cluster-gate'
import { IdeaCard, type MoveTarget } from './IdeaCard'

interface ClusterGateBoardProps {
  runId: string
  /** Fired after a successful confirm so the deep-link dispatcher can re-read
   *  the run's stage and advance to the next gate. */
  onConfirmed?: () => void
}

const ORPHAN_TARGET = 'orphans'

/**
 * Gate-A cluster board (LUM-669). Renders Stage-1's clustering as cards with a
 * separate orphan zone, lets the reviewer rename a cluster and move ideas
 * between clusters / orphans (no merge/split), and confirms the edit — which
 * advances the run to alignment and triggers Stage-2. Editing is purely local
 * until Confirm; the load `revision` rides along so a stale confirm 409s
 * (optimistic concurrency, cf. doc LUM-409) rather than clobbering.
 *
 * SRP: this component owns UI state + rendering only; the fetch/confirm calls
 * go through the api-client, and all business rules live behind the gate API.
 * Each idea renders as an <IdeaCard> (LUM-685) — it owns the statement's
 * clamp/expand and the move menu.
 */
export function ClusterGateBoard({
  runId,
  onConfirmed,
}: ClusterGateBoardProps) {
  const intl = useIntl()
  const [view, setView] = useState<ClusterGateView | null>(null)
  const [clusters, setClusters] = useState<ClusterGateCluster[]>([])
  const [orphans, setOrphans] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirmedStage, setConfirmedStage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    setConfirmError(null)
    setConfirmedStage(null)
    try {
      const data = await planRunsClient.getClusterGate(runId)
      setView(data)
      setClusters(
        data.board.clusters.map(c => ({ ...c, ideaIds: [...c.ideaIds] }))
      )
      setOrphans([...data.board.orphans])
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'planGateA.loadFailed' })
      )
    }
  }, [runId, intl])

  useEffect(() => {
    void load()
  }, [load])

  const ideaById = useMemo(() => {
    const map = new Map<string, ClusterGateIdea>()
    for (const idea of view?.ideas ?? []) map.set(idea.id, idea)
    return map
  }, [view])

  const gateOpen =
    view?.run.stage === 'CLUSTERS_READY' && confirmedStage === null
  const statement = (id: string) => ideaById.get(id)?.statement ?? id
  const sourceContext = (id: string) => ideaById.get(id)?.sourceContext ?? null

  const clusterLabel = (name: string, index: number) =>
    name.trim() ||
    intl.formatMessage(
      { id: 'planGateA.clusterFallback' },
      { index: index + 1 }
    )

  const rename = (index: number, name: string) => {
    setClusters(prev => prev.map((c, i) => (i === index ? { ...c, name } : c)))
  }

  /** Move an idea to a target bucket: a cluster index (as string) or 'orphans'. */
  const moveIdea = (ideaId: string, target: string) => {
    setClusters(prev =>
      prev.map((c, i) => {
        const without = c.ideaIds.filter(id => id !== ideaId)
        if (target === String(i)) return { ...c, ideaIds: [...without, ideaId] }
        return { ...c, ideaIds: without }
      })
    )
    setOrphans(prev => {
      const without = prev.filter(id => id !== ideaId)
      return target === ORPHAN_TARGET ? [...without, ideaId] : without
    })
  }

  const confirm = async () => {
    setSaving(true)
    setConfirmError(null)
    try {
      const res = await planRunsClient.confirmClusterGate(runId, {
        clusters,
        orphans,
        ifRevision: view?.revision ?? 0,
      })
      setConfirmedStage(res.run.stage)
      onConfirmed?.()
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setConfirmError(
          intl.formatMessage(
            { id: 'planGateA.conflict' },
            { message: err.message }
          )
        )
      } else {
        setConfirmError(
          err instanceof Error
            ? err.message
            : intl.formatMessage({ id: 'planGateA.confirmFailed' })
        )
      }
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className='space-y-3'>
        <p className='text-sm text-danger-text'>{loadError}</p>
        <Button variant='outline' onClick={() => void load()}>
          {intl.formatMessage({ id: 'planGateA.retry' })}
        </Button>
      </div>
    )
  }

  if (!view) {
    return (
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'planGateA.loading' })}
      </p>
    )
  }

  const moveTargets = (currentTarget: string): MoveTarget[] =>
    [
      ...clusters.map((c, i) => ({
        value: String(i),
        label: clusterLabel(c.name, i),
      })),
      {
        value: ORPHAN_TARGET,
        label: intl.formatMessage({ id: 'planGateA.orphansTarget' }),
      },
    ].filter(o => o.value !== currentTarget)

  return (
    <div className='space-y-8'>
      <header className='space-y-1'>
        <h1 className='text-xl font-semibold text-foreground'>
          {intl.formatMessage({ id: 'planGateA.title' })}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'planGateA.subtitle' })}
        </p>
      </header>

      {confirmedStage !== null ? (
        <p className='rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground'>
          {intl.formatMessage(
            { id: 'planGateA.confirmed' },
            { stage: confirmedStage }
          )}
        </p>
      ) : !gateOpen ? (
        <p className='rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground'>
          {intl.formatMessage(
            { id: 'planGateA.gateClosed' },
            { stage: view.run.stage }
          )}
        </p>
      ) : null}

      <div className='grid items-start gap-6 sm:grid-cols-2'>
        {clusters.map((cluster, index) => (
          <section
            key={index}
            className='space-y-3 rounded-lg border border-border p-4'
          >
            <div className='space-y-1.5'>
              <Input
                aria-label={intl.formatMessage(
                  { id: 'planGateA.clusterNameLabel' },
                  { index: index + 1 }
                )}
                value={cluster.name}
                disabled={!gateOpen}
                onChange={e => rename(index, e.target.value)}
                className='font-medium'
              />
              {cluster.thrust ? (
                <p className='text-xs text-muted-foreground'>
                  {cluster.thrust}
                </p>
              ) : null}
            </div>
            <ul className='space-y-2'>
              {cluster.ideaIds.map(id => (
                <IdeaCard
                  key={id}
                  statement={statement(id)}
                  sourceContext={sourceContext(id)}
                  moveTargets={moveTargets(String(index))}
                  moveLabel={intl.formatMessage(
                    { id: 'planGateA.moveIdeaLabel' },
                    { statement: statement(id) }
                  )}
                  onMove={target => moveIdea(id, target)}
                  movable={gateOpen}
                />
              ))}
              {cluster.ideaIds.length === 0 ? (
                <li className='rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground'>
                  {intl.formatMessage({ id: 'planGateA.emptyCluster' })}
                </li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>

      <section className='space-y-3 rounded-lg border border-dashed border-border p-4'>
        <h2 className='text-sm font-medium text-foreground'>
          {intl.formatMessage(
            { id: 'planGateA.orphansTitle' },
            { count: orphans.length }
          )}
        </h2>
        <ul className='grid items-start gap-2 sm:grid-cols-2'>
          {orphans.map(id => (
            <IdeaCard
              key={id}
              statement={statement(id)}
              sourceContext={sourceContext(id)}
              moveTargets={moveTargets(ORPHAN_TARGET)}
              moveLabel={intl.formatMessage(
                { id: 'planGateA.moveOrphanLabel' },
                { statement: statement(id) }
              )}
              onMove={target => moveIdea(id, target)}
              movable={gateOpen}
            />
          ))}
          {orphans.length === 0 ? (
            <li className='text-xs italic text-muted-foreground'>
              {intl.formatMessage({ id: 'planGateA.orphansEmpty' })}
            </li>
          ) : null}
        </ul>
      </section>

      {confirmError ? (
        <p className='text-sm text-danger-text'>{confirmError}</p>
      ) : null}

      <div className='flex items-center gap-3'>
        <Button onClick={() => void confirm()} disabled={!gateOpen || saving}>
          {saving
            ? intl.formatMessage({ id: 'planGateA.confirming' })
            : intl.formatMessage({ id: 'planGateA.confirm' })}
        </Button>
        <Button variant='outline' onClick={() => void load()} disabled={saving}>
          {intl.formatMessage({ id: 'planGateA.reset' })}
        </Button>
      </div>
    </div>
  )
}
