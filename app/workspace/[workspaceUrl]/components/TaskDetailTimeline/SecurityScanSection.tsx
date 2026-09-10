'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { useSecurityScans } from '../../hooks/useSecurityScans'
import { SecurityScanBadge } from '../pr-helpers'
import type {
  SecurityFindingView,
  SecurityScanView,
  TaskSecurityScans,
} from '@/lib/services/pr-security-scan.service'
import type { ScanStageKey, ScanStages } from '@/lib/security-scan/types'

type Disposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'

/**
 * LUM-732 — per-PR security findings with human disposition controls.
 * Data comes from useSecurityScans; the disposition write goes through the
 * API client and invalidates the same query. No business logic here.
 */
export function SecurityScanSection({ taskId }: { taskId: string }) {
  const intl = useIntl()
  const { data, isLoading, isError } = useSecurityScans(taskId)
  // A dropped read is said out loud (review I4). Rendering null instead let a
  // task with a blocking finding look like a task with nothing to review.
  if (isError)
    return (
      <p
        data-testid='security-scan-load-error'
        className='mt-4 text-caption text-muted-foreground'
      >
        {intl.formatMessage({ id: 'securityScan.section.loadError' })}
      </p>
    )
  if (isLoading || !data) return null
  if (data.prs.length === 0) return null
  return <SecurityScanPanel taskId={taskId} data={data} />
}

function SecurityScanPanel({
  taskId,
  data,
}: {
  taskId: string
  data: TaskSecurityScans
}) {
  const intl = useIntl()
  return (
    <div data-testid='security-scan-panel' className='mt-4'>
      <h4 className='text-caption font-medium text-foreground'>
        {intl.formatMessage({ id: 'securityScan.section.title' })}
      </h4>
      {data.blocking.count > 0 && (
        <p
          data-testid='security-blocking-banner'
          className='mt-2 rounded-sm border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-caption text-destructive'
        >
          {intl.formatMessage(
            { id: 'securityScan.banner.blocking' },
            { count: data.blocking.count }
          )}
        </p>
      )}
      {data.prs.every(p => p.latest === null) ? (
        <p className='mt-2 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'securityScan.section.empty' })}
        </p>
      ) : (
        <ul className='mt-2 space-y-3'>
          {data.prs.map(({ pr, latest }) => (
            <li key={pr.id} data-testid={`security-pr-${pr.number}`}>
              <div className='flex items-center gap-2'>
                <a
                  href={pr.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-caption text-foreground hover:underline'
                >
                  #{pr.number} {pr.title}
                </a>
                <SecurityScanBadge scan={latest} />
                {latest && (
                  <span className='font-mono text-caption text-muted-foreground'>
                    {intl.formatMessage(
                      { id: 'securityScan.meta' },
                      { sha: latest.headSha.slice(0, 7) }
                    )}
                  </span>
                )}
              </div>
              {latest && <ScanDetails taskId={taskId} scan={latest} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Layers worth a line: anything not RAN / SKIPPED. Order is the pipeline's. */
const STAGE_ORDER: ScanStageKey[] = ['secrets', 'external', 'judge']

function StagesSummary({ stages }: { stages: ScanStages }) {
  const intl = useIntl()
  const rows = STAGE_ORDER.flatMap(key => {
    const state = stages[key]
    if (!state || state === 'RAN' || state === 'SKIPPED') return []
    return [{ key, state }]
  })
  if (rows.length === 0) return null
  return (
    <p data-testid='scan-stages' className='text-caption text-warning'>
      {rows
        .map(
          r =>
            `${intl.formatMessage({ id: `securityScan.stage.${r.key}` })}: ${intl.formatMessage({ id: `securityScan.stageState.${r.state}` })}`
        )
        .join(' · ')}
    </p>
  )
}

function ScanDetails({
  taskId,
  scan,
}: {
  taskId: string
  scan: SecurityScanView
}) {
  const intl = useIntl()
  const pathname = usePathname()
  const workspaceSlug = pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? null
  const apiKeysHref = workspaceSlug
    ? `/workspace/${workspaceSlug}/settings/api-keys`
    : '#'
  return (
    <div className='mt-1.5 space-y-1.5'>
      <StagesSummary stages={scan.stages} />
      {scan.externalLate && (
        <p data-testid='external-late' className='text-caption text-warning'>
          {intl.formatMessage({ id: 'securityScan.external.late' })}
        </p>
      )}
      {scan.stages.external === 'NOT_CONFIGURED' && (
        <p
          data-testid='external-not-configured'
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage({ id: 'securityScan.external.notConfigured' })}{' '}
          <a
            href={apiKeysHref}
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-2 hover:text-foreground'
          >
            {intl.formatMessage({
              id: 'securityScan.external.notConfigured.link',
            })}
          </a>
        </p>
      )}
      {scan.partial && (
        <p data-testid='scan-partial' className='text-caption text-warning'>
          {intl.formatMessage({ id: 'securityScan.partial' })}
        </p>
      )}
      {scan.judgeStatus === 'UNAVAILABLE' && (
        <p
          data-testid='judge-unavailable'
          className='text-caption text-warning'
        >
          {intl.formatMessage({ id: 'securityScan.judgeUnavailable' })}
        </p>
      )}
      {scan.truncated && (
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'securityScan.truncated' })}
        </p>
      )}
      {scan.error &&
        (scan.stages.external === 'FAILED' || scan.status === 'FAILED') && (
          <p
            {...(scan.stages.external === 'FAILED'
              ? { 'data-testid': 'external-failed-reason' }
              : {})}
            className='font-mono text-caption text-muted-foreground'
          >
            {scan.stages.external === 'FAILED'
              ? `${intl.formatMessage({ id: 'securityScan.external.failedReason' })} ${scan.error}`
              : scan.error}
          </p>
        )}
      {scan.findings.map(f => (
        <FindingRow key={f.id} taskId={taskId} finding={f} />
      ))}
    </div>
  )
}

function FindingRow({
  taskId,
  finding,
}: {
  taskId: string
  finding: SecurityFindingView
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Disposition | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!pending) return
    setSubmitting(true)
    setError(null)
    try {
      await tasksClient.dispositionSecurityFinding(taskId, finding.id, {
        disposition: pending,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.securityScans(taskId),
      })
      setPending(null)
      setNote('')
    } catch {
      setError(intl.formatMessage({ id: 'securityScan.action.error' }))
    } finally {
      setSubmitting(false)
    }
  }

  const severityTone =
    finding.severity === 'HIGH' ? 'text-destructive' : 'text-muted-foreground'

  return (
    <div
      data-testid={`security-finding-${finding.id}`}
      data-blocking={finding.blocking}
      className='rounded-sm border border-border px-2 py-1.5'
    >
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption'>
        <span className={`font-medium uppercase ${severityTone}`}>
          {intl.formatMessage({
            id: `securityScan.severity.${finding.severity}`,
          })}
        </span>
        <span className='text-foreground'>{finding.title}</span>
        <span className='font-mono text-muted-foreground'>
          {finding.filePath}
          {finding.line != null ? `:${finding.line}` : ''}
        </span>
        <span className='text-muted-foreground'>
          {intl.formatMessage({
            id: `securityScan.provenance.${finding.provenance}`,
          })}
        </span>
        {finding.disposition && (
          <span
            data-testid='finding-disposition'
            className='text-muted-foreground'
          >
            {intl.formatMessage({
              id: `securityScan.disposition.${finding.disposition}`,
            })}
            {finding.inherited &&
              ` · ${intl.formatMessage({ id: 'securityScan.disposition.inherited' })}`}
          </span>
        )}
      </div>
      <p className='mt-0.5 text-caption text-muted-foreground'>
        {finding.detail}
      </p>
      {finding.evidence !== '' && (
        <pre className='mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-caption text-muted-foreground'>
          {finding.evidence}
        </pre>
      )}
      {finding.externalRef && (
        <a
          data-testid='finding-external-link'
          href={finding.externalRef}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-0.5 inline-block text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground'
        >
          {intl.formatMessage({ id: 'securityScan.finding.externalLink' })}
        </a>
      )}
      {!finding.disposition && (
        <div className='mt-1 flex flex-wrap items-center gap-1.5'>
          {pending === null ? (
            <>
              <button
                type='button'
                onClick={() => setPending('FALSE_POSITIVE')}
                className='text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground'
              >
                {intl.formatMessage({
                  id: 'securityScan.action.falsePositive',
                })}
              </button>
              <button
                type='button'
                onClick={() => setPending('ACCEPTED_RISK')}
                className='text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground'
              >
                {intl.formatMessage({ id: 'securityScan.action.acceptRisk' })}
              </button>
            </>
          ) : (
            <>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'securityScan.action.notePlaceholder',
                })}
                aria-label={intl.formatMessage({
                  id: 'securityScan.action.notePlaceholder',
                })}
                className='h-6 min-w-[12rem] flex-1 rounded-sm border border-border bg-background px-1.5 text-caption'
              />
              <button
                type='button'
                disabled={submitting}
                onClick={submit}
                className='text-caption font-medium text-foreground'
              >
                {intl.formatMessage({ id: 'securityScan.action.confirm' })}
              </button>
              <button
                type='button'
                disabled={submitting}
                onClick={() => {
                  setPending(null)
                  setNote('')
                }}
                className='text-caption text-muted-foreground'
              >
                {intl.formatMessage({ id: 'securityScan.action.cancel' })}
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p
          data-testid='finding-disposition-error'
          className='mt-0.5 text-caption text-destructive'
        >
          {error}
        </p>
      )}
    </div>
  )
}
