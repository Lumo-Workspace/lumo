'use client'

import { Fragment, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown, ChevronRight, Download, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AUDIT_ACTIONS, AUDIT_RETENTION_DAYS } from '@/lib/audit/actions'
import { AUDIT_EXPORT_MAX_ROWS, type AuditEventView } from '@/lib/audit/query'
import { auditClient } from '@/lib/api-client/audit'
import { useAuditEvents } from '../../hooks/useAuditEvents'
import { useMembers } from '../../hooks/useMembers'

/** Radix Select items cannot have an empty value. */
const ALL = 'all'

interface AuditFilterState {
  action: string
  actor: string
  since: string
  until: string
}

const EMPTY_FILTERS: AuditFilterState = {
  action: '',
  actor: '',
  since: '',
  until: '',
}

interface ActorOption {
  value: string
  label: string
}

/**
 * LUM-907 — settings → Audit log (OWNER only; the nav hides it from
 * members and the API answers 403). Filters by action, actor and date
 * range; newest first with "Load more"; the CSV download carries the same
 * filters. Action keys are shown verbatim — they are the stable ids the
 * CSV export and `lumo audit list --action` use.
 */
export function AuditLogSettingsPage() {
  const intl = useIntl()
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS)
  const params = useMemo(() => ({ ...filters }), [filters])
  const audit = useAuditEvents(params)
  const { members } = useMembers()

  const actorOptions: ActorOption[] = useMemo(
    () => [
      ...members.map(m => ({ value: m.clerkId, label: m.name })),
      {
        value: 'system',
        label: intl.formatMessage({ id: 'settings.auditLog.actor.system' }),
      },
    ],
    [members, intl]
  )

  const set = (key: keyof AuditFilterState, value: string) =>
    setFilters(prev => ({ ...prev, [key]: value === ALL ? '' : value }))

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-5xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'settings.auditLog.title' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-6'>
          {intl.formatMessage(
            { id: 'settings.auditLog.description' },
            { days: AUDIT_RETENTION_DAYS }
          )}
        </p>

        {audit.forbidden ? (
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'settings.auditLog.ownerOnly' })}
          </p>
        ) : (
          <>
            <AuditFilters
              filters={filters}
              actorOptions={actorOptions}
              onChange={set}
              onReset={() => setFilters(EMPTY_FILTERS)}
              exportHref={auditClient.exportUrl(params)}
            />
            <AuditEventsBody
              events={audit.events}
              isLoading={audit.isLoading}
              isError={audit.isError}
            />
            {audit.hasMore && (
              <div className='mt-4 flex justify-center'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={audit.isLoadingMore}
                  onClick={audit.loadMore}
                >
                  {intl.formatMessage({ id: 'settings.auditLog.loadMore' })}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AuditFilters({
  filters,
  actorOptions,
  onChange,
  onReset,
  exportHref,
}: {
  filters: AuditFilterState
  actorOptions: ActorOption[]
  onChange: (key: keyof AuditFilterState, value: string) => void
  onReset: () => void
  exportHref: string
}) {
  const intl = useIntl()
  const t = (id: string) => intl.formatMessage({ id })
  return (
    <div className='mb-4 flex flex-wrap items-end gap-3'>
      <label className='flex flex-col gap-1 text-xs text-muted-foreground'>
        {t('settings.auditLog.filter.action')}
        <Select
          value={filters.action || ALL}
          onValueChange={v => onChange('action', v)}
        >
          <SelectTrigger
            className='h-8 w-56 text-sm'
            aria-label={t('settings.auditLog.filter.action')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t('settings.auditLog.filter.allActions')}
            </SelectItem>
            {AUDIT_ACTIONS.map(a => (
              <SelectItem key={a} value={a} className='font-mono text-xs'>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className='flex flex-col gap-1 text-xs text-muted-foreground'>
        {t('settings.auditLog.filter.actor')}
        <Select
          value={filters.actor || ALL}
          onValueChange={v => onChange('actor', v)}
        >
          <SelectTrigger
            className='h-8 w-44 text-sm'
            aria-label={t('settings.auditLog.filter.actor')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t('settings.auditLog.filter.allActors')}
            </SelectItem>
            {actorOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className='flex flex-col gap-1 text-xs text-muted-foreground'>
        {t('settings.auditLog.filter.since')}
        <Input
          type='date'
          className='h-8 w-36 text-sm'
          value={filters.since}
          max={filters.until || undefined}
          onChange={e => onChange('since', e.target.value)}
        />
      </label>
      <label className='flex flex-col gap-1 text-xs text-muted-foreground'>
        {t('settings.auditLog.filter.until')}
        <Input
          type='date'
          className='h-8 w-36 text-sm'
          value={filters.until}
          min={filters.since || undefined}
          onChange={e => onChange('until', e.target.value)}
        />
      </label>
      <Button variant='ghost' size='sm' onClick={onReset}>
        {t('settings.auditLog.filter.reset')}
      </Button>
      <div className='ml-auto'>
        <Button variant='outline' size='sm' asChild>
          <a
            href={exportHref}
            download
            title={intl.formatMessage(
              { id: 'settings.auditLog.exportHint' },
              { max: intl.formatNumber(AUDIT_EXPORT_MAX_ROWS) }
            )}
          >
            <Download size={14} />
            {t('settings.auditLog.export')}
          </a>
        </Button>
      </div>
    </div>
  )
}

function AuditEventsBody({
  events,
  isLoading,
  isError,
}: {
  events: AuditEventView[]
  isLoading: boolean
  isError: boolean
}) {
  const intl = useIntl()
  if (isLoading) {
    return (
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'common.loading' })}
      </p>
    )
  }
  if (isError) {
    return (
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'settings.auditLog.loadFailed' })}
      </p>
    )
  }
  if (events.length === 0) {
    return (
      <div className='text-center py-12'>
        <ScrollText size={32} className='mx-auto mb-3 text-muted-foreground' />
        <p className='text-sm font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'settings.auditLog.empty' })}
        </p>
      </div>
    )
  }
  return <AuditEventsTable events={events} />
}

function AuditEventsTable({ events }: { events: AuditEventView[] }) {
  const intl = useIntl()
  const t = (id: string) => intl.formatMessage({ id })
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className='rounded-lg border border-border overflow-hidden'>
      <Table>
        <TableHeader className='bg-muted'>
          <TableRow>
            <TableHead className='w-8' />
            <TableHead>{t('settings.auditLog.col.time')}</TableHead>
            <TableHead>{t('settings.auditLog.col.actor')}</TableHead>
            <TableHead>{t('settings.auditLog.col.action')}</TableHead>
            <TableHead>{t('settings.auditLog.col.target')}</TableHead>
            <TableHead>{t('settings.auditLog.col.source')}</TableHead>
            <TableHead>{t('settings.auditLog.col.ip')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map(e => {
            const expanded = open === e.id
            return (
              <Fragment key={e.id}>
                <TableRow>
                  <TableCell className='w-8 pr-0'>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-6 w-6 text-muted-foreground'
                      aria-expanded={expanded}
                      aria-label={t('settings.auditLog.details.toggle')}
                      onClick={() => setOpen(expanded ? null : e.id)}
                    >
                      {expanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className='whitespace-nowrap text-muted-foreground'>
                    {intl.formatDate(e.createdAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell className='max-w-48 truncate'>
                    {actorLabel(e, t)}
                  </TableCell>
                  <TableCell className='font-mono text-xs'>
                    {e.action}
                  </TableCell>
                  <TableCell className='max-w-48 truncate text-muted-foreground'>
                    <span className='font-mono text-xs'>
                      {e.targetType}
                      {e.targetId ? ` · ${e.targetId}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {t(`settings.auditLog.source.${e.source}`)}
                  </TableCell>
                  <TableCell className='font-mono text-xs text-muted-foreground'>
                    {e.ip ?? '—'}
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className='bg-muted/50 hover:bg-muted/50'>
                    <TableCell />
                    <TableCell colSpan={6}>
                      <AuditEventDetails event={e} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function actorLabel(e: AuditEventView, t: (id: string) => string): string {
  if (e.actorType === 'SYSTEM') return t('settings.auditLog.actor.system')
  if (e.actorType === 'AGENT') {
    return `${t('settings.auditLog.actor.agent')} · ${e.actorId ?? ''}`
  }
  return e.actorName ?? e.actorEmail ?? e.actorId ?? '—'
}

function AuditEventDetails({ event }: { event: AuditEventView }) {
  const intl = useIntl()
  const t = (id: string) => intl.formatMessage({ id })
  return (
    <dl className='grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs'>
      {event.actorEmail && (
        <>
          <dt className='text-muted-foreground'>
            {t('settings.auditLog.details.email')}
          </dt>
          <dd className='break-all'>{event.actorEmail}</dd>
        </>
      )}
      <dt className='text-muted-foreground'>
        {t('settings.auditLog.details.userAgent')}
      </dt>
      <dd className='break-all'>{event.userAgent ?? '—'}</dd>
      <dt className='text-muted-foreground'>
        {t('settings.auditLog.details.metadata')}
      </dt>
      <dd>
        <pre className='whitespace-pre-wrap break-all font-mono'>
          {event.metadata ? JSON.stringify(event.metadata, null, 2) : '—'}
        </pre>
      </dd>
    </dl>
  )
}
