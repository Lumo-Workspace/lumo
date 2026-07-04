'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ApiClientError,
  planRunsClient,
  type ClusterGateIdea,
  type ClusterGateView,
} from '@/lib/api-client'
import type { ClusterGateCluster } from '@/lib/plan-run/cluster-gate'

interface ClusterGateBoardProps {
  runId: string
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
 */
export function ClusterGateBoard({ runId }: ClusterGateBoardProps) {
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
        err instanceof Error ? err.message : 'Failed to load the board'
      )
    }
  }, [runId])

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
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setConfirmError(
          `${err.message} — someone else changed this clustering; reload to get the latest.`
        )
      } else {
        setConfirmError(err instanceof Error ? err.message : 'Confirm failed')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className='space-y-3'>
        <p className='text-sm text-destructive'>{loadError}</p>
        <Button variant='outline' onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }

  if (!view) {
    return (
      <p className='text-sm text-muted-foreground'>
        Loading the cluster board…
      </p>
    )
  }

  const moveOptions = (currentTarget: string) =>
    [
      ...clusters.map((c, i) => ({
        value: String(i),
        label: c.name.trim() || `Cluster ${i + 1}`,
      })),
      { value: ORPHAN_TARGET, label: 'Orphans' },
    ].filter(o => o.value !== currentTarget)

  return (
    <div className='space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-xl font-semibold text-foreground'>
          Review the clusters
        </h1>
        <p className='text-sm text-muted-foreground'>
          Rename a cluster or move an idea between clusters and the orphan zone,
          then confirm to move on to alignment.
        </p>
      </header>

      {confirmedStage !== null ? (
        <p className='rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground'>
          Confirmed. The run advanced to{' '}
          <span className='font-medium'>{confirmedStage}</span> and alignment is
          running.
        </p>
      ) : !gateOpen ? (
        <p className='rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground'>
          This gate is closed (run stage: {view.run.stage}). Editing is
          disabled.
        </p>
      ) : null}

      <div className='grid gap-4 sm:grid-cols-2'>
        {clusters.map((cluster, index) => (
          <section
            key={index}
            className='space-y-3 rounded-lg border border-border p-4'
          >
            <Input
              aria-label={`Cluster ${index + 1} name`}
              value={cluster.name}
              disabled={!gateOpen}
              onChange={e => rename(index, e.target.value)}
              className='font-medium'
            />
            {cluster.thrust ? (
              <p className='text-xs text-muted-foreground'>{cluster.thrust}</p>
            ) : null}
            <ul className='space-y-2'>
              {cluster.ideaIds.map(id => (
                <li
                  key={id}
                  className='flex items-start justify-between gap-2 rounded-md bg-muted/40 p-2'
                >
                  <span className='text-sm text-foreground'>
                    {statement(id)}
                  </span>
                  {gateOpen ? (
                    <select
                      aria-label={`Move idea ${statement(id)}`}
                      className='shrink-0 rounded-md border border-border bg-background px-1 py-0.5 text-xs text-muted-foreground'
                      value=''
                      onChange={e =>
                        e.target.value && moveIdea(id, e.target.value)
                      }
                    >
                      <option value=''>Move to…</option>
                      {moveOptions(String(index)).map(o => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </li>
              ))}
              {cluster.ideaIds.length === 0 ? (
                <li className='text-xs italic text-muted-foreground'>
                  (empty — move an idea here)
                </li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>

      <section className='space-y-3 rounded-lg border border-dashed border-border p-4'>
        <h2 className='text-sm font-medium text-foreground'>
          Orphans{' '}
          <span className='text-muted-foreground'>({orphans.length})</span>
        </h2>
        <ul className='space-y-2'>
          {orphans.map(id => (
            <li
              key={id}
              className='flex items-start justify-between gap-2 rounded-md bg-muted/40 p-2'
            >
              <span className='text-sm text-foreground'>{statement(id)}</span>
              {gateOpen ? (
                <select
                  aria-label={`Move orphan idea ${statement(id)}`}
                  className='shrink-0 rounded-md border border-border bg-background px-1 py-0.5 text-xs text-muted-foreground'
                  value=''
                  onChange={e => e.target.value && moveIdea(id, e.target.value)}
                >
                  <option value=''>Move to…</option>
                  {moveOptions(ORPHAN_TARGET).map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </li>
          ))}
          {orphans.length === 0 ? (
            <li className='text-xs italic text-muted-foreground'>
              No orphans — every idea belongs to a cluster.
            </li>
          ) : null}
        </ul>
      </section>

      {confirmError ? (
        <p className='text-sm text-destructive'>{confirmError}</p>
      ) : null}

      <div className='flex items-center gap-3'>
        <Button onClick={() => void confirm()} disabled={!gateOpen || saving}>
          {saving ? 'Confirming…' : 'Confirm clusters'}
        </Button>
        <Button variant='outline' onClick={() => void load()} disabled={saving}>
          Reset
        </Button>
      </div>
    </div>
  )
}
