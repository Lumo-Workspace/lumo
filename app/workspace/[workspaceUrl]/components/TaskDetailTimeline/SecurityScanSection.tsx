'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Check, Copy } from 'lucide-react'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { useSecurityScans } from '../../hooks/useSecurityScans'
import { SecurityScanBadge } from '../pr-helpers'
import type {
  SecurityFindingView,
  SecurityScanView,
  TaskSecurityScans,
} from '@/lib/services/pr-security-scan.service'
import type { ScanStages } from '@/lib/security-scan/types'
import { SCAN_STAGE_KEYS } from '@/shared/src/security-scan'
// Pure module (no Node built-ins, no Prisma) — safe in a client component.
import { EXTERNAL_ERROR_PREFIX } from '@/lib/security-scan/stages'
import { summarizeSecurityScans, shouldExpandRow } from './security-summary'
import { buildAgentContext } from './security-agent-context'

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
  // LUM-496 Task 3: one summary line above the per-PR rows so a reviewer reads
  // "7 PRs · 3 findings (all LOW) · 2 external scans failed" without opening
  // anything. The severity note and the failed-scan clause are separate keys
  // (composed here, not baked into the ICU message) so a zero failed count
  // never leaves a dangling " · " with nothing after it.
  const summary = summarizeSecurityScans(data.prs)
  const severityNote = summary.allLow
    ? ` (${intl.formatMessage({ id: 'record.security.allLow' })})`
    : ''
  // Review F1 (honesty): with a scan still incomplete, zero findings is not
  // "no findings" — it is "no findings *on the scans that finished*". The
  // composite `record.security.summary` bakes its own =0 branch, so that case
  // is composed from the PR-count clause plus the qualified one instead.
  const qualifyZero =
    summary.findings === 0 &&
    (summary.incomplete > 0 || summary.overSizeLimit > 0)
  const summaryText = qualifyZero
    ? [
        intl.formatMessage(
          { id: 'record.security.prs' },
          { count: summary.prs }
        ),
        intl.formatMessage({ id: 'record.security.noneOnComplete' }),
      ].join(' · ')
    : intl.formatMessage(
        { id: 'record.security.summary' },
        { prs: summary.prs, findings: summary.findings, severityNote }
      )
  const incompleteText =
    summary.incomplete > 0
      ? intl.formatMessage(
          { id: 'record.security.incomplete' },
          { count: summary.incomplete }
        )
      : ''
  // LUM-832: a layer skipped for size is not "not fully checked yet" —
  // nothing is coming later; the change was over the limit.
  const overSizeLimitText =
    summary.overSizeLimit > 0
      ? intl.formatMessage(
          { id: 'record.security.overSizeLimit' },
          { count: summary.overSizeLimit }
        )
      : ''
  const failedText =
    summary.externalFailed > 0
      ? intl.formatMessage(
          { id: 'record.security.failed' },
          { count: summary.externalFailed }
        )
      : ''
  const summaryLine = [
    summaryText,
    incompleteText,
    overSizeLimitText,
    failedText,
  ]
    .filter(Boolean)
    .join(' · ')

  // Per-PR expansion (LUM-496): defaults to `shouldExpandRow` (an open finding,
  // an incomplete scan, or an external failure with an error) but a manual
  // toggle sticks — keyed by
  // PR id so re-renders (e.g. after a disposition) don't reset a human's choice.
  const [expandedOverrides, setExpandedOverrides] = useState<
    Record<string, boolean>
  >({})
  const isExpanded = (prId: string, latest: SecurityScanView | null) =>
    expandedOverrides[prId] ?? shouldExpandRow(latest)
  const toggleRow = (prId: string, latest: SecurityScanView | null) =>
    setExpandedOverrides(prev => ({
      ...prev,
      [prId]: !isExpanded(prId, latest),
    }))

  return (
    <div data-testid='security-scan-panel' className='mt-4'>
      <h4 className='text-caption uppercase tracking-wide text-muted-foreground'>
        {intl.formatMessage({ id: 'securityScan.section.title' })}
      </h4>
      <p
        data-testid='security-summary-line'
        className='mt-0.5 text-caption text-muted-foreground'
      >
        {summaryLine}
      </p>
      {(data.suggested?.count ?? 0) > 0 && (
        <ConfirmAllSuggested taskId={taskId} count={data.suggested.count} />
      )}
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
        <ul className='mt-2 space-y-2'>
          {data.prs.map(({ pr, latest }) => {
            const expanded = isExpanded(pr.id, latest)
            return (
              <li
                key={pr.id}
                data-testid={`security-pr-${pr.number}`}
                className='rounded-sm border border-border px-2 py-1.5'
              >
                {/* A link inside a button is invalid HTML — the row is a div
                with the toggle button and the PR link side by side. */}
                <div className='flex items-center gap-2'>
                  {/* Review F2 (a11y): the chevron is the only content, so
                  without a label a screen reader announces a bare "button" —
                  name it after the row it opens (the PR the reader sees). */}
                  <button
                    type='button'
                    aria-expanded={expanded}
                    aria-label={`#${pr.number} ${pr.title}`}
                    data-testid={`security-pr-${pr.number}-toggle`}
                    onClick={() => toggleRow(pr.id, latest)}
                    className='shrink-0 text-muted-foreground hover:text-foreground'
                  >
                    <ChevronRight
                      className={`size-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
                      aria-hidden
                    />
                  </button>
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
                    <span className='ml-auto font-mono text-caption text-muted-foreground'>
                      {intl.formatMessage(
                        { id: 'securityScan.meta' },
                        { sha: latest.headSha.slice(0, 7) }
                      )}
                    </span>
                  )}
                </div>
                {expanded && latest && (
                  <ScanDetails
                    taskId={taskId}
                    prNumber={pr.number}
                    scan={latest}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Every layer the scan carries, in pipeline order (LUM-740: the stage row).
 * Taken from the shared key list rather than re-typed here (LUM-763) — the
 * same list the PR summary and `lumo task status` render from, so a sixth
 * layer can never reach one surface and not another.
 */
const STAGE_ORDER = SCAN_STAGE_KEYS

/**
 * LUM-740: one line per scan naming every layer and its state — a reader
 * sees at a glance which layers ran. The line takes the warning tone only
 * while some layer is not RAN / SKIPPED.
 */
function StagesSummary({
  stages,
  huntProgress,
}: {
  stages: ScanStages
  /** LUM-832 — a batched hunt's covered source files, or null. */
  huntProgress: SecurityScanView['huntProgress']
}) {
  const intl = useIntl()
  const rows = STAGE_ORDER.flatMap(key => {
    const state = stages[key]
    return state ? [{ key, state }] : []
  })
  if (rows.length === 0) return null
  const incomplete = rows.some(r => r.state !== 'RAN' && r.state !== 'SKIPPED')
  return (
    <p
      data-testid='scan-stages'
      data-incomplete={incomplete}
      className={`text-caption ${incomplete ? 'text-warning' : 'text-muted-foreground'}`}
    >
      {rows
        .map(r => {
          const line = `${intl.formatMessage({ id: `securityScan.stage.${r.key}` })}: ${intl.formatMessage({ id: `securityScan.stageState.${r.state}` })}`
          return r.key === 'hunt' && huntProgress
            ? `${line} (${intl.formatMessage(
                { id: 'securityScan.huntProgress' },
                {
                  covered: huntProgress.coveredFiles,
                  total: huntProgress.totalFiles,
                }
              )})`
            : line
        })
        .join(' · ')}
    </p>
  )
}

/** LUM-740: one click confirms every LLM-suggested false positive on the task (human-only route). */
function ConfirmAllSuggested({
  taskId,
  count,
}: {
  taskId: string
  count: number
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirmAll() {
    setSubmitting(true)
    setError(null)
    try {
      await tasksClient.bulkDispositionSecurityFindings(taskId)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.securityScans(taskId),
      })
    } catch {
      setError(intl.formatMessage({ id: 'securityScan.action.error' }))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className='mt-2 flex flex-wrap items-center gap-2'>
      <button
        type='button'
        data-testid='security-confirm-all-suggested'
        disabled={submitting}
        onClick={confirmAll}
        className='rounded-sm border border-border px-2 py-0.5 text-caption text-foreground hover:bg-muted'
      >
        {intl.formatMessage(
          { id: 'securityScan.action.confirmAllSuggested' },
          { count }
        )}
      </button>
      {error && <span className='text-caption text-destructive'>{error}</span>}
    </div>
  )
}

function ScanDetails({
  taskId,
  prNumber,
  scan,
}: {
  taskId: string
  prNumber: number
  scan: SecurityScanView
}) {
  const intl = useIntl()
  const pathname = usePathname()
  const workspaceSlug = pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? null
  const apiKeysHref = workspaceSlug
    ? `/workspace/${workspaceSlug}/settings/api-keys`
    : '#'
  // P8: `error` is one column with two writers — the ingest workflow's
  // scrubbed reason (prefixed) and stage A's own raw `error.message`. Only the
  // prefixed one may be shown as the external scanner's reason, and only the
  // text after the prefix.
  const externalReason =
    scan.stages.external === 'FAILED' &&
    scan.error?.startsWith(EXTERNAL_ERROR_PREFIX)
      ? scan.error.slice(EXTERNAL_ERROR_PREFIX.length)
      : null
  return (
    <div className='mt-1.5 space-y-1.5'>
      <StagesSummary
        stages={scan.stages}
        huntProgress={scan.huntProgress ?? null}
      />
      {scan.fixed > 0 && (
        <p
          data-testid='scan-fixed'
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage(
            { id: 'securityScan.fixed' },
            { count: scan.fixed }
          )}
        </p>
      )}
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
      {/* LUM-832: one owned line, whatever the cause. It used to name a
          reason — "cut off at the scan budget", "large changes may be
          under-reviewed" — that was usually wrong and always ours; the stage
          row above already says which layer did not finish. */}
      {scan.ownedUnfinished && (
        <p data-testid='scan-unfinished' className='text-caption text-warning'>
          {intl.formatMessage({ id: 'securityScan.partial' })}
        </p>
      )}
      {/* LUM-832: a layer over its size cap did not run — told the way
          CodeRabbit tells its own limit: the change is too large, and how to
          get the layer (narrow the scope or split the PR). */}
      {scan.huntOverCap && (
        <p data-testid='scan-over-cap' className='text-caption text-warning'>
          {intl.formatMessage(
            { id: 'securityScan.huntOverCap' },
            {
              files: scan.huntOverCap.sourceFiles,
              cap: scan.huntOverCap.capFiles,
            }
          )}
        </p>
      )}
      {scan.judgeOverCap && (
        <p
          data-testid='scan-judge-over-cap'
          className='text-caption text-warning'
        >
          {intl.formatMessage(
            { id: 'securityScan.judgeOverCap' },
            {
              size: scan.judgeOverCap.diffChars,
              cap: scan.judgeOverCap.capChars,
            }
          )}
        </p>
      )}
      {externalReason && (
        <p
          data-testid='external-failed-reason'
          className='font-mono text-caption text-muted-foreground'
        >
          {`${intl.formatMessage({ id: 'securityScan.external.failedReason' })} ${externalReason}`}
        </p>
      )}
      {!externalReason && scan.error && scan.status === 'FAILED' && (
        <p className='font-mono text-caption text-muted-foreground'>
          {scan.error}
        </p>
      )}
      {scan.findings.map(f => (
        <FindingRow
          key={f.id}
          taskId={taskId}
          prNumber={prNumber}
          finding={f}
        />
      ))}
    </div>
  )
}

function FindingRow({
  taskId,
  prNumber,
  finding,
}: {
  taskId: string
  prNumber: number
  finding: SecurityFindingView
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Disposition | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chainOpen, setChainOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )
  const suggestedOpen =
    finding.suggestedDisposition !== null && finding.disposition === null

  async function copyForAgent() {
    try {
      await navigator.clipboard.writeText(
        buildAgentContext(finding, { number: prNumber })
      )
    } catch {
      return
    }
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1200)
  }

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

  // LUM-738: a finding already on the default branch is not this PR's —
  // muted, labelled, and its HIGH loses the red so the eye lands on new rows.
  // LUM-775: same treatment for a row that left the queue when the PR
  // merged / closed — the label says why, and a human can still decide.
  const muted = finding.persisting || finding.queueExit != null
  const severityTone =
    finding.severity === 'HIGH' && !muted
      ? 'text-destructive'
      : 'text-muted-foreground'

  return (
    <div
      data-testid={`security-finding-${finding.id}`}
      data-blocking={finding.blocking}
      data-persisting={finding.persisting}
      data-queue-exit={finding.queueExit ?? undefined}
      className={`rounded-sm border border-border px-2 py-1.5${
        muted ? ' opacity-60' : ''
      }`}
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
        {finding.kind !== 'DEPENDENCY' && (
          <span data-testid='finding-kind' className='text-muted-foreground'>
            {intl.formatMessage({ id: `securityScan.kind.${finding.kind}` })}
          </span>
        )}
        <span className='text-muted-foreground'>
          {intl.formatMessage({
            id: `securityScan.provenance.${finding.provenance}`,
          })}
        </span>
        {finding.reachability && (
          <span
            data-testid='finding-reachability'
            className='rounded-sm bg-muted px-1 text-muted-foreground'
          >
            {intl.formatMessage({
              id: `securityScan.reachability.${finding.reachability}`,
            })}
          </span>
        )}
        {finding.cwe && (
          <span className='font-mono text-muted-foreground'>{finding.cwe}</span>
        )}
        {suggestedOpen && (
          <span
            data-testid='finding-suggested'
            className='rounded-sm border border-warning/40 px-1 text-warning'
          >
            {intl.formatMessage({ id: 'securityScan.suggested.falsePositive' })}
          </span>
        )}
        {finding.suggestionOutcome && (
          <span
            data-testid='finding-suggestion-outcome'
            className='text-muted-foreground'
          >
            {intl.formatMessage({
              id: `securityScan.suggested.outcome.${finding.suggestionOutcome}`,
            })}
          </span>
        )}
        {finding.kind === 'DEPENDENCY' && (
          <span
            data-testid='finding-dependency'
            className='text-muted-foreground'
          >
            {intl.formatMessage({ id: 'securityScan.finding.dependency' })}
          </span>
        )}
        {finding.persisting && (
          <span
            data-testid='finding-persisting'
            className='rounded-sm bg-muted px-1 text-muted-foreground'
          >
            {intl.formatMessage({ id: 'securityScan.finding.persisting' })}
          </span>
        )}
        {finding.queueExit && (
          <span
            data-testid='finding-queue-exit'
            className='rounded-sm bg-muted px-1 text-muted-foreground'
          >
            {intl.formatMessage({
              id: `securityScan.finding.queueExit.${finding.queueExit}`,
            })}
          </span>
        )}
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
      {suggestedOpen && finding.suggestedReason && (
        <p
          data-testid='finding-suggested-reason'
          className='mt-0.5 text-caption text-muted-foreground'
        >
          {`${intl.formatMessage({ id: 'securityScan.suggested.reasonLabel' })} ${finding.suggestedReason}`}
        </p>
      )}
      {finding.callChain && finding.callChain.length > 0 && (
        <div className='mt-0.5'>
          <button
            type='button'
            aria-expanded={chainOpen}
            onClick={() => setChainOpen(o => !o)}
            className='text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground'
          >
            {intl.formatMessage({ id: 'securityScan.callChain' })}
          </button>
          {chainOpen && (
            <ol
              data-testid='finding-call-chain'
              className='mt-0.5 space-y-0.5 font-mono text-caption text-muted-foreground'
            >
              {finding.callChain.map((edge, i) => (
                <li key={i}>{`${edge.from} → ${edge.to}`}</li>
              ))}
            </ol>
          )}
        </div>
      )}
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
                aria-label={intl.formatMessage({
                  id: copied
                    ? 'securityScan.action.copied'
                    : 'securityScan.action.copyForAgent',
                })}
                title={intl.formatMessage({
                  id: 'securityScan.action.copyForAgent',
                })}
                onClick={copyForAgent}
                className='inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground'
              >
                {copied ? (
                  <Check className='size-3' aria-hidden />
                ) : (
                  <Copy className='size-3' aria-hidden />
                )}
                {intl.formatMessage({
                  id: copied
                    ? 'securityScan.action.copied'
                    : 'securityScan.action.copyForAgent',
                })}
              </button>
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
