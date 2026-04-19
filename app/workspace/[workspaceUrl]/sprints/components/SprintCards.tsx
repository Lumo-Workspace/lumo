'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useSprintsForTeam, useSprint } from '../../hooks/useSprints'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Sprint } from '@prisma/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysFromNow(date: Date | string): number {
  const ms = new Date(date).getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ─── Active sprint card ───────────────────────────────────────────────────────

function ActiveSprintCard({
  sprint,
  workspaceUrl,
}: {
  sprint: Sprint
  workspaceUrl: string
}) {
  const intl = useIntl()
  const { sprint: detail, progress } = useSprint(sprint.id)
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const remaining = daysFromNow(sprint.endDate)
  const overdue = remaining < 0

  return (
    <Card>
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='text-base'>
            {detail?.name ?? sprint.name}
          </CardTitle>
          <span className='text-xs text-muted-foreground shrink-0'>
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </span>
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='space-y-1'>
          <div className='flex justify-between text-xs text-muted-foreground'>
            <span>
              {done} / {total}
            </span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className='h-2' />
        </div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            {overdue && (
              <div className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950'>
                <span
                  className='text-xs font-semibold text-destructive'
                  aria-label={intl.formatMessage(
                    { id: 'sprints.landing.overdue' },
                    { count: Math.abs(remaining) }
                  )}
                >
                  ⚠
                </span>
                <span className='text-xs font-medium text-destructive'>
                  {intl.formatMessage(
                    { id: 'sprints.landing.overdue' },
                    { count: Math.abs(remaining) }
                  )}
                </span>
              </div>
            )}
            {!overdue && (
              <span className='text-xs text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'sprints.landing.daysLeft' },
                  { count: remaining }
                )}
              </span>
            )}
          </div>
          <div className='flex gap-2'>
            <Button asChild size='sm' variant='default'>
              <Link href={`/workspace/${workspaceUrl}/sprints/${sprint.id}`}>
                {intl.formatMessage({ id: 'sprints.landing.openBoard' })}
              </Link>
            </Button>
            <Button asChild size='sm' variant='outline'>
              <Link
                href={`/workspace/${workspaceUrl}/sprints/${sprint.id}/close`}
              >
                {intl.formatMessage({ id: 'sprints.landing.close' })}
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Draft sprint card ────────────────────────────────────────────────────────

function DraftSprintCard({
  sprint,
  workspaceUrl,
}: {
  sprint: Sprint
  workspaceUrl: string
}) {
  const intl = useIntl()

  return (
    <Card>
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='text-base'>{sprint.name}</CardTitle>
          <span className='text-xs text-muted-foreground shrink-0'>
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className='flex gap-2'>
          <Button asChild size='sm' variant='default'>
            <Link href={`/workspace/${workspaceUrl}/sprints/${sprint.id}`}>
              {intl.formatMessage({ id: 'sprints.landing.plan' })}
            </Link>
          </Button>
          <Button asChild size='sm' variant='outline'>
            <Link
              href={`/workspace/${workspaceUrl}/sprints/${sprint.id}/start`}
            >
              {intl.formatMessage({ id: 'sprints.landing.start' })}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Closed sprint row ────────────────────────────────────────────────────────

function ClosedSprintRow({
  sprint,
  workspaceUrl,
}: {
  sprint: Sprint
  workspaceUrl: string
}) {
  const intl = useIntl()

  return (
    <div className='flex items-center justify-between py-2 border-b last:border-0'>
      <div className='flex flex-col gap-0.5 min-w-0'>
        <span className='text-sm font-medium truncate'>{sprint.name}</span>
        <span className='text-xs text-muted-foreground'>
          {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
        </span>
      </div>
      <Button asChild size='sm' variant='ghost'>
        <Link href={`/workspace/${workspaceUrl}/sprints/${sprint.id}/retro`}>
          {intl.formatMessage({ id: 'sprints.landing.viewRetro' })}
        </Link>
      </Button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SprintCards({ teamId }: { teamId: string }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()

  const { sprints: activeSprints, isLoading: loadingActive } =
    useSprintsForTeam(teamId, 'ACTIVE')
  const { sprints: draftSprints, isLoading: loadingDraft } = useSprintsForTeam(
    teamId,
    'DRAFT'
  )
  const { sprints: closedSprints, isLoading: loadingClosed } =
    useSprintsForTeam(teamId, 'CLOSED')

  const activeSprint = activeSprints?.[0]
  const draftSprint = draftSprints?.[0]
  const recent = closedSprints?.slice(0, 5) ?? []

  const isLoading = loadingActive || loadingDraft || loadingClosed

  const isEmpty =
    !isLoading && !activeSprint && !draftSprint && recent.length === 0

  if (isEmpty) {
    return (
      <p className='text-sm text-muted-foreground py-4'>
        {intl.formatMessage({ id: 'sprints.landing.empty' })}
      </p>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Active */}
      {activeSprint && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            {intl.formatMessage({ id: 'sprints.landing.active' })}
          </h2>
          <ActiveSprintCard sprint={activeSprint} workspaceUrl={workspaceUrl} />
        </section>
      )}

      {/* Next (Draft) */}
      {draftSprint && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            {intl.formatMessage({ id: 'sprints.landing.next' })}
          </h2>
          <DraftSprintCard sprint={draftSprint} workspaceUrl={workspaceUrl} />
        </section>
      )}

      {/* Recent (Closed) */}
      {recent.length > 0 && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            {intl.formatMessage({ id: 'sprints.landing.recent' })}
          </h2>
          <Card>
            <CardContent className='pt-2 pb-1 px-4'>
              {recent.map(s => (
                <ClosedSprintRow
                  key={s.id}
                  sprint={s}
                  workspaceUrl={workspaceUrl}
                />
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}
