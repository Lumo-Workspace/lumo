'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { queryKeys } from '@/lib/query/keys'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import { MAX_STARRED, selectStarredAligned } from '@/lib/plan-run/gate-b'
import { ClusterAlignCard, type ClusterCardState } from './ClusterAlignCard'

interface Props {
  runId: string
  /** Called after a successful confirm (e.g. to advance the run view). */
  onConfirmed?: (selectedClusterIds: string[]) => void
}

/**
 * Gate B (闸门B · 对齐确认) board (LUM-670, Spec2-8). Renders one card per aligned
 * cluster; the human switches the three-way verdict, edits the one-line
 * rationale, and stars ≤2 ALIGNED clusters. Confirming freezes the judgment
 * into the ALIGN stage record's `humanConfirmedOutput`, advances the run to
 * GENERATING, and hands the starred ALIGNED clusters to Stage 3.
 */
export function GateBBoard({ runId, onConfirmed }: Props) {
  const intl = useIntl()
  const qc = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.planRuns.alignGate(runId),
    queryFn: () => planRunsClient.getAlignGate(runId),
  })

  const [cards, setCards] = useState<ClusterCardState[]>([])

  // Seed local edit state from the server verdicts once loaded (or on refetch).
  useEffect(() => {
    if (!data) return
    setCards(
      data.clusters.map(c => ({
        clusterId: c.clusterId,
        verdict: c.verdict,
        rationale: c.rationale,
        customizationTrap: c.customizationTrap,
        starred: false,
        name: c.name,
        thrust: c.thrust,
        ideas: c.ideas,
        // Default is keep-everything; unchecking is the deliberate act.
        keptIdeaIds: c.ideas.map(i => i.id),
      }))
    )
  }, [data])

  const starredCount = cards.filter(c => c.starred).length
  const starCapReached = starredCount >= MAX_STARRED

  const selectedIds = useMemo(
    () => selectStarredAligned(cards).map(c => c.clusterId),
    [cards]
  )

  const confirmMutation = useMutation({
    mutationFn: () =>
      planRunsClient.confirmAlignGate(runId, {
        clusters: cards.map(c => ({
          clusterId: c.clusterId,
          verdict: c.verdict,
          starred: c.starred,
          ideaIds: c.keptIdeaIds,
          rationale: c.rationale,
        })),
      }),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: queryKeys.planRuns.alignGate(runId) })
      onConfirmed?.(result.selectedClusterIds)
    },
  })

  function updateCard(clusterId: string, patch: Partial<ClusterCardState>) {
    setCards(prev =>
      prev.map(c => {
        if (c.clusterId !== clusterId) return c
        const next = { ...c, ...patch }
        // Switching a starred cluster away from ALIGNED drops its star, so the
        // selection can never contain a non-ALIGNED starred cluster. Emptying
        // a starred cluster's ideas drops it for the same reason: a star means
        // "plan this now", and there would be nothing left to plan (LUM-688).
        if (next.verdict !== 'ALIGNED' || next.keptIdeaIds.length === 0) {
          next.starred = false
        }
        return next
      })
    )
  }

  /** Keep/drop one idea. Unchecking removes it from THIS plan only — the idea
   *  stays in the pool, unmarked, for a later run. */
  function toggleIdea(clusterId: string, ideaId: string) {
    const card = cards.find(c => c.clusterId === clusterId)
    if (!card) return
    const kept = card.keptIdeaIds.includes(ideaId)
    updateCard(clusterId, {
      keptIdeaIds: kept
        ? card.keptIdeaIds.filter(id => id !== ideaId)
        : // Re-check restores gate-A order, so the payload never depends on
          // the order the reviewer happened to click.
          card.ideas
            .map(i => i.id)
            .filter(id => card.keptIdeaIds.includes(id) || id === ideaId),
    })
  }

  if (isLoading) return <Spinner />
  if (isError || !data) {
    return (
      <p className='text-sm text-danger-text'>
        {intl.formatMessage({ id: 'planGate.loadError' })}
      </p>
    )
  }
  if (cards.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'planGate.empty' })}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <header className='flex flex-col gap-1'>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'planGate.title' })}
        </h2>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage(
            { id: 'planGate.starHint' },
            { max: MAX_STARRED }
          )}
        </p>
      </header>

      <div className='flex flex-col gap-3'>
        {cards.map(card => (
          <ClusterAlignCard
            key={card.clusterId}
            cluster={card}
            starCapReached={starCapReached}
            onVerdictChange={verdict => updateCard(card.clusterId, { verdict })}
            onRationaleChange={rationale =>
              updateCard(card.clusterId, { rationale })
            }
            onToggleStar={() =>
              updateCard(card.clusterId, { starred: !card.starred })
            }
            onToggleIdea={ideaId => toggleIdea(card.clusterId, ideaId)}
          />
        ))}
      </div>

      <footer className='flex items-center justify-between gap-3'>
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage(
            { id: 'planGate.starCount' },
            { count: starredCount, max: MAX_STARRED }
          )}
        </span>
        <Button
          type='button'
          disabled={confirmMutation.isPending || selectedIds.length === 0}
          onClick={() => confirmMutation.mutate()}
        >
          {confirmMutation.isPending
            ? intl.formatMessage({ id: 'planGate.confirming' })
            : intl.formatMessage({ id: 'planGate.confirm' })}
        </Button>
      </footer>
    </div>
  )
}
