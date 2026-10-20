'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import {
  useSprintAttention,
  useSprintByNumber,
  useSprintTasks,
  useSprintsForTeam,
} from '../../hooks/useSprints'
import { useWorkspaceTeams } from '../../hooks/useWorkspaceTeams'
import type { ApiStatus, MyTask } from '../../types'
import type { SprintAttentionScope } from '@/lib/api-client/sprints'
import { useNow } from '@/hooks/use-now'
import { deriveSprintState } from '@/lib/services/sprint-date'
import { daysFromNow } from '../components/sprintLandingUtils'
import { SprintActionsMenu } from '../components/SprintActionsMenu'
import { CloseSprintDialog } from '../components/CloseSprintDialog'
import { SprintDetailHeader } from '../components/detail/SprintDetailHeader'
import {
  ClosedSprintActions,
  LiveSprintActions,
} from '../components/detail/SprintHeaderActions'
import { pickNextSprint } from '../components/detail/retro-view-model'
import { ClosedSprintRetro } from './ClosedSprintRetro'
import { StageCards } from '../components/detail/StageCards'
import { AwaitingPeopleCard } from '../components/detail/AwaitingPeopleCard'
import { CostOutputCard } from '../components/detail/CostOutputCard'
import { SprintTaskTable } from '../components/detail/SprintTaskTable'
import {
  buildStageCards,
  summarizeQueueKinds,
  toQueueRows,
  toTaskRows,
} from '../components/detail/view-model'
import { DetailLayout } from '@/app/workspace/[workspaceUrl]/components/DetailLayout'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

function AttentionError() {
  const intl = useIntl()
  return (
    <Empty className='border border-border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <CircleAlert />
        </EmptyMedia>
        <EmptyTitle>
          {intl.formatMessage({ id: 'sprints.detail.attentionError' })}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

interface SprintDetailClientProps {
  /** Open the global NewTaskModal with the current sprint pre-selected. */
  onNewTask?: (sprintId: string, teamId: string, status?: ApiStatus) => void
  /** Open the global task drawer for a clicked task. */
  onOpenTask?: (task: MyTask) => void
}

/**
 * LUM-1279 — the attention-first Sprint detail page. Orchestrates data only:
 * the sprint, its attention read model (LUM-1278) and the task list it opens
 * tasks from; every section below is a flat-prop presentational component.
 *
 * LUM-1281 — a CLOSED sprint renders the retro layout (`ClosedSprintRetro`)
 * instead. Keyed on the stored status, not the date-derived state: a sprint
 * past its end date but not yet closed stays live so it can still be closed.
 */
export function SprintDetailClient({
  onNewTask,
  onOpenTask,
}: SprintDetailClientProps = {}) {
  const { sprintId, workspaceUrl } = useParams<{
    sprintId: string
    workspaceUrl: string
  }>()
  const router = useRouter()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const now = useNow()

  // The `sprintId` segment is the per-team sprint number (e.g. `1`).
  const parsedNumber = Number(sprintId)
  const sprintNumber = Number.isInteger(parsedNumber) ? parsedNumber : null
  const { sprint, isLoading, error, refetch } = useSprintByNumber(
    workspaceUrl,
    sprintNumber
  )
  const id = sprint?.id ?? null
  const { tasks, refetch: refetchTasks } = useSprintTasks(id)
  const { teams } = useWorkspaceTeams()
  const closed = sprint?.status === 'CLOSED'
  // Only a closed sprint needs its team's sprints (for "go to next sprint").
  const { sprints: teamSprints } = useSprintsForTeam(
    closed ? (sprint?.teamId ?? null) : null
  )

  const [scope, setScope] = useState<SprintAttentionScope>('mine')
  const team = useSprintAttention(id, 'team')
  // No awaiting-people queue on a closed sprint, so no "mine" read either.
  const mine = useSprintAttention(
    scope === 'mine' && !closed ? id : null,
    'mine'
  )
  const [closeOpen, setCloseOpen] = useState(false)

  const teamQueue = useMemo(() => team.attention?.queue ?? [], [team.attention])
  const attentionTasks = useMemo(
    () => team.attention?.tasks ?? [],
    [team.attention]
  )
  const stageCards = useMemo(
    () => (team.attention ? buildStageCards(team.attention, teamQueue) : null),
    [team.attention, teamQueue]
  )
  const queueRows = useMemo(
    () =>
      toQueueRows(
        scope === 'mine' ? (mine.attention?.queue ?? []) : teamQueue,
        attentionTasks
      ),
    [scope, mine.attention, teamQueue, attentionTasks]
  )
  const taskRows = useMemo(
    () => toTaskRows(attentionTasks, teamQueue),
    [attentionTasks, teamQueue]
  )

  const sprintsHref = `/workspace/${workspaceUrl}/sprints`
  const sprintsLabel = intl.formatMessage({ id: 'sidebar.sprints' })

  function breadcrumb(currentLabel: string) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={sprintsHref}>{sprintsLabel}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  if (isLoading || error || !sprint) {
    const label = intl.formatMessage({
      id: isLoading ? 'sprints.detail.loading' : 'sprints.detail.notFound',
    })
    return (
      <DetailLayout breadcrumb={breadcrumb(label)}>
        <div className='p-6 text-muted-foreground'>{label}</div>
      </DetailLayout>
    )
  }

  const state = now === null ? null : deriveSprintState(sprint, new Date(now))
  const daysLeft =
    now === null ? null : Math.max(0, daysFromNow(sprint.endDate, now))
  const teamName = teams.find(t => t.id === sprint.teamId)?.name ?? null

  function refreshAll() {
    refetch()
    refetchTasks()
    void queryClient.invalidateQueries({ queryKey: ['sprints', 'attention'] })
  }

  // Prefer the drawer; a task the list hasn't caught up with yet (or a page
  // mounted without a drawer) opens its own page instead of doing nothing.
  // A carried-over task has left the sprint, so its row hands its identifier.
  function openTask(taskId: string, knownIdentifier?: string) {
    const task = (tasks as MyTask[] | undefined)?.find(t => t.id === taskId)
    if (task && onOpenTask) return onOpenTask(task)
    const identifier =
      knownIdentifier ??
      attentionTasks.find(t => t.taskId === taskId)?.identifier
    if (identifier)
      router.push(`/workspace/${workspaceUrl}/my-tasks/${identifier}`)
  }

  const cost = team.attention?.cost ?? null
  const next = closed ? pickNextSprint(teamSprints, sprint.number) : null
  const nextSprint = next
    ? { name: next.name, href: `${sprintsHref}/${next.number}` }
    : null

  return (
    <DetailLayout
      breadcrumb={
        <div className='flex items-center gap-1.5'>
          {breadcrumb(sprint.name)}
          <SprintActionsMenu
            sprint={sprint}
            onDeleted={() => router.push(sprintsHref)}
          />
        </div>
      }
      scrollBody
    >
      <div className='mx-auto flex w-full max-w-420 flex-col gap-5 px-4 pt-4 pb-8 sm:gap-6 sm:px-8 sm:pt-6 sm:pb-12'>
        <SprintDetailHeader
          sprint={sprint}
          name={sprint.name}
          teamName={teamName}
          state={state}
          daysLeft={daysLeft}
          onRefresh={refreshAll}
          actions={
            closed ? (
              <ClosedSprintActions nextSprint={nextSprint} />
            ) : (
              <LiveSprintActions
                canClose={sprint.status === 'ACTIVE'}
                onCloseSprint={() => setCloseOpen(true)}
                onNewTask={() => onNewTask?.(sprint.id, sprint.teamId)}
              />
            )
          }
        />

        {closed ? (
          <ClosedSprintRetro
            sprintId={sprint.id}
            attention={team.attention}
            attentionLoading={team.isLoading}
            attentionFailed={!!team.error}
            onOpenTask={openTask}
          />
        ) : team.error ? (
          <AttentionError />
        ) : (
          <>
            {stageCards ? (
              <StageCards {...stageCards} />
            ) : (
              <div className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'>
                {[0, 1, 2, 3].map(i => (
                  <Skeleton key={i} className='h-32' />
                ))}
              </div>
            )}

            <AwaitingPeopleCard
              scope={scope}
              onScopeChange={setScope}
              rows={queueRows}
              kinds={summarizeQueueKinds(queueRows)}
              loading={scope === 'mine' ? mine.isLoading : team.isLoading}
              error={!!(scope === 'mine' ? mine.error : team.error)}
              onOpenTask={openTask}
            />

            {cost && (
              <CostOutputCard
                tokensPerVerifiedTask={cost.tokensPerVerifiedTask}
                previousTokensPerVerifiedTask={
                  cost.previousSprint?.tokensPerVerifiedTask ?? null
                }
                reworkShare={cost.reworkShare}
                reworkTop={cost.reworkTop}
                onOpenTask={openTask}
              />
            )}

            {team.isLoading ? (
              <Skeleton className='h-64' />
            ) : (
              <SprintTaskTable rows={taskRows} onOpenTask={openTask} />
            )}
          </>
        )}
      </div>

      {closeOpen && (
        <CloseSprintDialog
          sprintId={sprint.id}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false)
            refreshAll()
          }}
        />
      )}
    </DetailLayout>
  )
}
