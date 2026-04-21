'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { useSprintsForTeam, useSprint } from '../../hooks/useSprints'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'
import { SprintActionsMenu } from './SprintActionsMenu'
import { DatePickerField, formatDate, startOfDay } from './DatePickerField'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysFromNow(date: Date | string): number {
  const ms = new Date(date).getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

// ─── Sprint landing card ──────────────────────────────────────────────────────

/**
 * Single card used for both the Current and Upcoming sections. Shape stays
 * constant so the eye doesn't have to re-parse a different layout between
 * sections — what changes is the time-relative subtitle (days left / starts
 * in / overdue by).
 */
function SprintLandingCard({
  sprint,
  workspaceUrl,
  onChanged,
}: {
  sprint: Sprint
  workspaceUrl: string
  onChanged: () => void
}) {
  const intl = useIntl()
  const { sprint: detail, progress } = useSprint(sprint.id)
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const daysToStart = daysFromNow(sprint.startDate)
  const daysToEnd = daysFromNow(sprint.endDate)
  const upcoming = daysToStart > 0
  const overdue = !upcoming && daysToEnd < 0

  return (
    <Link
      href={`/workspace/${workspaceUrl}/sprints/${sprint.number}`}
      className='block'
    >
      <Card className='transition-colors hover:bg-accent/40'>
        <CardHeader className='pb-2'>
          <div className='flex items-start justify-between gap-2'>
            <CardTitle className='text-base'>
              {detail?.name ?? sprint.name}
            </CardTitle>
            <div className='flex items-center gap-2 shrink-0'>
              <span className='text-xs text-muted-foreground'>
                {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
              </span>
              <SprintActionsMenu sprint={sprint} onDeleted={onChanged} />
            </div>
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
          <div className='flex items-center gap-2'>
            {overdue ? (
              <div className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950'>
                <span
                  className='text-xs font-semibold text-destructive'
                  aria-hidden
                >
                  ⚠
                </span>
                <span className='text-xs font-medium text-destructive'>
                  {intl.formatMessage(
                    { id: 'sprints.landing.overdue' },
                    { count: Math.abs(daysToEnd) }
                  )}
                </span>
              </div>
            ) : upcoming ? (
              <span className='text-xs text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'sprints.landing.startsIn' },
                  { count: daysToStart }
                )}
              </span>
            ) : (
              <span className='text-xs text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'sprints.landing.daysLeft' },
                  { count: daysToEnd }
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

// ─── Closed sprint row ────────────────────────────────────────────────────────

function ClosedSprintRow({
  sprint,
  workspaceUrl,
  onChanged,
}: {
  sprint: Sprint
  workspaceUrl: string
  onChanged: () => void
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
      <div className='flex items-center gap-1 shrink-0'>
        <Button asChild size='sm' variant='ghost'>
          <Link href={`/workspace/${workspaceUrl}/sprints/${sprint.number}`}>
            {intl.formatMessage({ id: 'sprints.landing.viewRetro' })}
          </Link>
        </Button>
        <SprintActionsMenu sprint={sprint} onDeleted={onChanged} />
      </div>
    </div>
  )
}

// ─── Create-sprint dialog ─────────────────────────────────────────────────────

interface CreateSprintInput {
  name?: string
  startDate: Date
  endDate: Date
}

function CreateSprintDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmit: (input: CreateSprintInput) => void
}) {
  const intl = useIntl()
  const today = startOfDay(new Date())
  // 14 days inclusive of both endpoints → end is start + 13.
  const defaultEnd = startOfDay(
    new Date(today.getTime() + 13 * 24 * 60 * 60 * 1000)
  )
  const [name, setName] = useState('')
  const [start, setStart] = useState<Date>(today)
  const [end, setEnd] = useState<Date>(defaultEnd)

  const valid = end > start

  function submit() {
    if (!valid) return
    onSubmit({
      ...(name.trim() ? { name: name.trim() } : {}),
      startDate: start,
      endDate: end,
    })
    // Close immediately — parent owns the optimistic update + toast.
    onOpenChange(false)
    setName('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'sprints.create.title' })}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='sprint-name'>
              {intl.formatMessage({ id: 'sprints.create.name' })}
            </Label>
            <Input
              id='sprint-name'
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'sprints.create.namePlaceholder',
              })}
              maxLength={120}
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <Label htmlFor='sprint-start'>
                {intl.formatMessage({ id: 'sprints.create.startDate' })}
              </Label>
              <DatePickerField
                id='sprint-start'
                value={start}
                onChange={setStart}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='sprint-end'>
                {intl.formatMessage({ id: 'sprints.create.endDate' })}
              </Label>
              <DatePickerField id='sprint-end' value={end} onChange={setEnd} />
            </div>
          </div>
          {!valid && (
            <p className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.create.invalidRange' })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: 'sprints.create.cancel' })}
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {intl.formatMessage({ id: 'sprints.create.submit' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SprintCards({ teamId }: { teamId: string }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()

  const {
    sprints,
    setSprints,
    isLoading,
    refetch: refetchAll,
  } = useSprintsForTeam(teamId)

  const [createOpen, setCreateOpen] = useState(false)

  async function handleCreate(input: CreateSprintInput) {
    // Optimistic stub — same shape as Sprint so the landing card renders
    // without flicker. Reconciled by refetch on success.
    const optimisticId = `optimistic-${
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`
    const optimistic: Sprint = {
      id: optimisticId,
      teamId,
      number: 0,
      name: input.name?.trim() || '…',
      status: 'DRAFT',
      startDate: input.startDate,
      endDate: input.endDate,
      startedAt: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setSprints(prev => [...(prev ?? []), optimistic])

    try {
      await sprintsClient.createDraft(teamId, {
        ...(input.name ? { name: input.name } : {}),
        startDate: input.startDate.toISOString(),
        endDate: input.endDate.toISOString(),
      })
      toast.success(intl.formatMessage({ id: 'sprints.create.success' }))
      refetchAll()
    } catch (e) {
      // Roll back the optimistic insert.
      setSprints(prev => (prev ?? []).filter(s => s.id !== optimisticId))
      toast.error(e instanceof Error ? e.message : 'Create failed')
    }
  }

  // Partition purely by date so the landing page never lies about what's
  // "current" vs "upcoming" just because nobody clicked a state-transition
  // button.
  const now = Date.now()
  const bySortedStart = (sprints ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )
  const currentSprint = bySortedStart.find(
    s =>
      new Date(s.startDate).getTime() <= now &&
      now <= new Date(s.endDate).getTime()
  )
  const upcomingSprints = bySortedStart.filter(
    s => new Date(s.startDate).getTime() > now
  )
  const completedSprints = bySortedStart
    .filter(s => new Date(s.endDate).getTime() < now)
    .reverse() // most-recent first
  const recent = completedSprints.slice(0, 5)
  const noUpcoming = !currentSprint && upcomingSprints.length === 0

  const isEmpty =
    !isLoading &&
    !currentSprint &&
    upcomingSprints.length === 0 &&
    recent.length === 0

  if (isEmpty) {
    return (
      <>
        <div className='py-4 space-y-3'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.landing.empty' })}
          </p>
          <Button onClick={() => setCreateOpen(true)} size='sm'>
            {intl.formatMessage({ id: 'sprints.landing.newSprint' })}
          </Button>
        </div>
        <CreateSprintDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={handleCreate}
        />
      </>
    )
  }

  return (
    <div className='space-y-6'>
      {/* No current and no upcoming — let the user create one explicitly. */}
      {noUpcoming && (
        <div className='rounded border border-dashed p-4 flex items-center justify-between gap-3'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.landing.noUpcoming' })}
          </p>
          <Button onClick={() => setCreateOpen(true)} size='sm'>
            {intl.formatMessage({ id: 'sprints.landing.newSprint' })}
          </Button>
        </div>
      )}

      {/* Current */}
      {currentSprint && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            {intl.formatMessage({ id: 'sprints.landing.active' })}
          </h2>
          <SprintLandingCard
            sprint={currentSprint}
            workspaceUrl={workspaceUrl}
            onChanged={refetchAll}
          />
        </section>
      )}

      {/* Upcoming */}
      {upcomingSprints.length > 0 && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            {intl.formatMessage({ id: 'sprints.landing.next' })}
          </h2>
          <div className='space-y-3'>
            {upcomingSprints.map(s => (
              <SprintLandingCard
                key={s.id}
                sprint={s}
                workspaceUrl={workspaceUrl}
                onChanged={refetchAll}
              />
            ))}
          </div>
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
                  onChanged={refetchAll}
                />
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <CreateSprintDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
      />
    </div>
  )
}
