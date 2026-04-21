'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { CalendarDays, MoreHorizontal, Trash2 } from 'lucide-react'
import { enUS, zhCN, zhTW } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'

const CALENDAR_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Kebab menu + confirmation dialog. Stops Link/Card click propagation so
 * tapping the kebab on a card-as-link doesn't navigate.
 */
function SprintCardActions({
  sprint,
  onDeleted,
}: {
  sprint: Sprint
  onDeleted: () => void
}) {
  const intl = useIntl()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await sprintsClient.remove(sprint.id)
      toast.success(intl.formatMessage({ id: 'sprints.detail.deleted' }))
      onDeleted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-7 text-muted-foreground'
            onClick={stop}
            aria-label={intl.formatMessage({
              id: 'sprints.detail.openActions',
            })}
          >
            <MoreHorizontal className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' onClick={stop}>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onSelect={ev => {
              ev.preventDefault()
              setConfirmOpen(true)
            }}
          >
            <Trash2 className='size-4 mr-2' />
            {intl.formatMessage({ id: 'sprints.detail.deleteSprint' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent onClick={stop}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage(
                { id: 'sprints.detail.deleteConfirmTitle' },
                { name: sprint.name }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'sprints.detail.deleteConfirmBody' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {intl.formatMessage({ id: 'sprints.detail.deleteCancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {intl.formatMessage({ id: 'sprints.detail.deleteConfirm' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DatePickerField({
  id,
  value,
  onChange,
  locale,
}: {
  id: string
  value: Date
  onChange: (d: Date) => void
  locale: DateFnsLocale
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant='outline'
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground'
          )}
        >
          <CalendarDays className='mr-2 size-4' />
          {formatDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='!w-auto p-0' align='start'>
        <Calendar
          mode='single'
          style={{ '--cell-size': '2.5rem' } as React.CSSProperties}
          selected={value}
          onSelect={d => {
            if (d) {
              onChange(startOfDay(d))
              setOpen(false)
            }
          }}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  )
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
      href={`/workspace/${workspaceUrl}/sprints/${sprint.id}`}
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
              <SprintCardActions sprint={sprint} onDeleted={onChanged} />
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
          <Link href={`/workspace/${workspaceUrl}/sprints/${sprint.id}`}>
            {intl.formatMessage({ id: 'sprints.landing.viewRetro' })}
          </Link>
        </Button>
        <SprintCardActions sprint={sprint} onDeleted={onChanged} />
      </div>
    </div>
  )
}

// ─── Create-sprint dialog ─────────────────────────────────────────────────────

function CreateSprintDialog({
  teamId,
  open,
  onOpenChange,
  onCreated,
}: {
  teamId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const calendarLocale = CALENDAR_LOCALES[intl.locale] ?? enUS
  const valid = end > start

  async function submit() {
    if (!valid) return
    setError(null)
    setSubmitting(true)
    try {
      await sprintsClient.createDraft(teamId, {
        ...(name.trim() ? { name: name.trim() } : {}),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      })
      onCreated()
      onOpenChange(false)
      setName('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
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
                locale={calendarLocale}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='sprint-end'>
                {intl.formatMessage({ id: 'sprints.create.endDate' })}
              </Label>
              <DatePickerField
                id='sprint-end'
                value={end}
                onChange={setEnd}
                locale={calendarLocale}
              />
            </div>
          </div>
          {!valid && (
            <p className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.create.invalidRange' })}
            </p>
          )}
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: 'sprints.create.cancel' })}
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
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

  const { sprints, isLoading, refetch: refetchAll } = useSprintsForTeam(teamId)

  const [createOpen, setCreateOpen] = useState(false)

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
  const upcomingSprint = bySortedStart.find(
    s => new Date(s.startDate).getTime() > now
  )
  const completedSprints = bySortedStart
    .filter(s => new Date(s.endDate).getTime() < now)
    .reverse() // most-recent first
  const recent = completedSprints.slice(0, 5)
  const noUpcoming = !currentSprint && !upcomingSprint

  const isEmpty =
    !isLoading && !currentSprint && !upcomingSprint && recent.length === 0

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
          teamId={teamId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={refetchAll}
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
      {upcomingSprint && (
        <section className='space-y-2'>
          <h2 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
            {intl.formatMessage({ id: 'sprints.landing.next' })}
          </h2>
          <SprintLandingCard
            sprint={upcomingSprint}
            workspaceUrl={workspaceUrl}
            onChanged={refetchAll}
          />
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
        teamId={teamId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refetchAll}
      />
    </div>
  )
}
