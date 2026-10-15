'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useIntl } from 'react-intl'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronRight,
  Check,
  Copy,
  Info,
  Minus,
} from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { useSecurityScans } from '../../hooks/useSecurityScans'
import {
  ScanningOffBadge,
  SecurityScanBadge,
  showsScanningOff,
} from '@/ee/security/ui/pr-scan-badge'
import type {
  SecurityFindingView,
  SecurityScanView,
  TaskSecurityScans,
} from '@/ee/security/services/pr-security-scan.service'
import {
  JUDGE_PARTIAL_MAX_NAMED,
  SCAN_STAGE_KEYS,
  isJudgeOverCapByFiles,
  turnedOffLayers,
} from '@/shared/src/security-scan'
// Pure module (no Node built-ins, no Prisma) — safe in a client component.
import { EXTERNAL_ERROR_PREFIX } from '@/ee/security/security-scan/stages'
import {
  blockingFindings,
  groupFindings,
  isQuietFinding,
  shouldExpandRow,
  stageReason,
  type FindingGroup,
  type FindingGroupKey,
} from './security-summary'
import { buildAgentContext } from './security-agent-context'
import { Button } from '@/components/ui/button'
import { securityScanClient } from '@/ee/security/api-client'

/** `OPEN` = Reopen: revert a ruling (web only, LUM-1128 follow-up). */
type Disposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK' | 'OPEN'

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
        className='text-caption text-muted-foreground'
      >
        {intl.formatMessage({ id: 'securityScan.section.loadError' })}
      </p>
    )
  if (isLoading || !data) return null
  if (data.prs.length === 0) return null
  return <SecurityScanPanel taskId={taskId} data={data} />
}

/**
 * LUM-1009 — the Record tab's Needs action entries for security: only the
 * findings that block DONE, each with its disposition controls, across the
 * task's PRs. The full report stays in Records (`SecurityScanSection`); this
 * reads the same query, so a disposition here updates both.
 */
export function BlockingSecurityFindings({ taskId }: { taskId: string }) {
  const intl = useIntl()
  const { data } = useSecurityScans(taskId)
  const blocking = blockingFindings(data?.prs ?? [])
  if (blocking.length === 0) return null
  return (
    <div
      data-testid='security-blocking-findings'
      className='overflow-hidden rounded-lg border border-danger-border'
    >
      <div className='flex flex-wrap items-center gap-2 bg-danger-subtle px-4 py-2.5'>
        <span className='text-body-strong text-foreground'>
          {intl.formatMessage({ id: 'securityScan.section.title' })}
        </span>
        <span className='text-caption text-danger-text'>
          {intl.formatMessage(
            { id: 'record.queue.securityBlocking' },
            { count: blocking.length }
          )}
        </span>
      </div>
      <div className='space-y-2 border-t border-border px-4 py-3'>
        {blocking.map(({ prNumber, finding }) => (
          <div key={finding.id} className='space-y-1'>
            <div className='text-caption text-muted-foreground'>
              #{prNumber}
            </div>
            <FindingRow taskId={taskId} prNumber={prNumber} finding={finding} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SecurityScanPanel({
  taskId,
  data,
}: {
  taskId: string
  data: TaskSecurityScans
}) {
  const intl = useIntl()

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
    // LUM-1009/1012: the Record tab's row carries the title and the verdict.
    <div data-testid='security-scan-panel'>
      {(data.suggested?.count ?? 0) > 0 && (
        <ConfirmAllSuggested taskId={taskId} count={data.suggested.count} />
      )}
      {data.blocking.count > 0 && (
        <p
          data-testid='security-blocking-banner'
          className='mt-2 rounded-sm border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-caption text-danger-text'
        >
          {intl.formatMessage(
            { id: 'securityScan.banner.blocking' },
            { count: data.blocking.count }
          )}
        </p>
      )}
      {/* LUM-892: scanning turned off in settings — said up front, so the
          results below read as "from before", not as the PR's answer. */}
      {data.scanningOff && (
        <p
          data-testid='security-scanning-off'
          className='mt-2 rounded-sm border border-border bg-muted/40 px-2 py-1.5 text-caption text-muted-foreground'
        >
          {intl.formatMessage({
            id: data.prs.every(p => p.latest === null)
              ? 'securityScan.section.scanningOff'
              : 'securityScan.banner.scanningOff',
          })}
        </p>
      )}
      {data.prs.every(p => p.latest === null) ? (
        data.scanningOff ? null : (
          <p className='mt-2 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'securityScan.section.empty' })}
          </p>
        )
      ) : (
        // LUM-1012: one checklist row per PR — the PR and its result on one
        // line, and under it every layer with its own name (✓ checked, – not
        // needed / off, ! didn't run) and an ⓘ that says what it checks. The
        // names ride on each row so no header sits apart from the cells.
        <ul className='-my-1 divide-y divide-border/60'>
          {data.prs.map(({ pr, latest, reviewControl }) => {
            const expanded = isExpanded(pr.id, latest)
            return (
              <li
                key={pr.id}
                data-testid={`security-pr-${pr.number}`}
                className='py-2.5'
              >
                {/* A link inside a button is invalid HTML — the toggle and
                    the PR link sit side by side. */}
                <div className='flex items-center gap-2'>
                  {/* Review F2 (a11y): the chevron is the only content,
                      so name it after the row it opens. */}
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
                    title={
                      latest
                        ? intl.formatMessage(
                            { id: 'securityScan.meta' },
                            { sha: latest.headSha.slice(0, 7) }
                          )
                        : undefined
                    }
                    className='min-w-0 flex-1 truncate text-caption font-medium text-foreground hover:underline'
                  >
                    <span className='font-mono font-normal text-muted-foreground'>
                      #{pr.number}
                    </span>{' '}
                    {pr.title}
                  </a>
                  <span className='shrink-0'>
                    {data.scanningOff && showsScanningOff(latest) ? (
                      <ScanningOffBadge />
                    ) : (
                      <ScanResult scan={latest} />
                    )}
                  </span>
                </div>
                {pr.repo && pr.state === 'open' && (
                  <ReviewControls
                    taskId={taskId}
                    number={pr.number}
                    repo={pr.repo}
                    scan={latest}
                    {...(reviewControl ? { control: reviewControl } : {})}
                  />
                )}
                {pr.headSha && latest && pr.headSha !== latest.headSha && (
                  <p className='text-caption text-muted-foreground'>
                    {intl.formatMessage({ id: 'securityScan.review.stale' })}
                  </p>
                )}
                {latest ? (
                  <div className='mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[1.375rem]'>
                    {STAGE_ORDER.map(key => (
                      <StageItem key={key} stageKey={key} scan={latest} />
                    ))}
                  </div>
                ) : null}
                {expanded && latest && (
                  <div className='pl-[1.375rem]'>
                    <ScanDetails
                      taskId={taskId}
                      prNumber={pr.number}
                      scan={latest}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ReviewControls({
  taskId,
  number,
  repo,
  control,
  scan,
}: {
  taskId: string
  number: number
  repo: string
  control?: { paused: boolean; rounds: number; limit: number }
  scan: SecurityScanView | null
}) {
  const intl = useIntl()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [queued, setQueued] = useState(false)
  const requestedVersion = useRef<string | null>(null)
  const scanVersion = scan?.startedAt ?? null
  const scanRunning =
    scan?.status === 'RUNNING' ||
    scan?.status === 'PENDING' ||
    Object.values(scan?.stages ?? {}).includes('PENDING')
  // Manual dispatch may create its scan after our first invalidation. Keep
  // refreshing this report during that request, bounded to the scan/verifier
  // lifetime, without causing any additional review requests.
  useEffect(() => {
    if (!queued) return
    const timer = setInterval(() => {
      if (scanVersion !== requestedVersion.current && !scanRunning) {
        setQueued(false)
        return
      }
      void client.invalidateQueries({
        queryKey: queryKeys.tasks.securityScans(taskId),
      })
    }, 5000)
    const deadline = setTimeout(() => clearInterval(timer), 15 * 60_000)
    return () => {
      clearInterval(timer)
      clearTimeout(deadline)
    }
  }, [queued, client, taskId, scanVersion, scanRunning])
  async function act(action: 'pause' | 'resume' | 'incremental' | 'full') {
    setBusy(true)
    setError(false)
    setQueued(false)
    try {
      await tasksClient.reviewPullRequest(number, repo, action)
      requestedVersion.current = scanVersion
      setQueued(action === 'incremental' || action === 'full')
      await client.invalidateQueries({
        queryKey: queryKeys.tasks.securityScans(taskId),
      })
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className='mt-2 flex flex-wrap items-center gap-2'>
      {control && (
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage(
            {
              // LUM-1137: reviewed commits; limit 0 = never pauses.
              id:
                control.limit === 0
                  ? 'securityScan.review.roundsNoLimit'
                  : 'securityScan.review.rounds',
            },
            { rounds: control.rounds, limit: control.limit }
          )}
        </span>
      )}
      <Button
        variant='outline'
        size='sm'
        disabled={busy}
        onClick={() => void act('incremental')}
      >
        {intl.formatMessage({ id: 'securityScan.review.incremental' })}
      </Button>
      <Button
        variant='outline'
        size='sm'
        disabled={busy}
        onClick={() => void act('full')}
      >
        {intl.formatMessage({ id: 'securityScan.review.full' })}
      </Button>
      {!control?.paused && (
        <Button
          variant='ghost'
          size='sm'
          disabled={busy}
          onClick={() => void act('pause')}
        >
          {intl.formatMessage({ id: 'securityScan.review.pause' })}
        </Button>
      )}
      {(control?.paused || !control) && (
        <Button
          variant='ghost'
          size='sm'
          disabled={busy}
          onClick={() => void act('resume')}
        >
          {intl.formatMessage({ id: 'securityScan.review.resume' })}
        </Button>
      )}
      {error && (
        <span role='alert'>
          {intl.formatMessage({ id: 'securityScan.review.error' })}
        </span>
      )}
      {queued && (
        <span role='status'>
          {intl.formatMessage({ id: 'securityScan.review.queued' })}
        </span>
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
 * The scanners behind each layer, named in its ⓘ card. Product names, not
 * copy — never translated. Code scan's are the managed scan's tools
 * (`MANAGED_SCAN_TOOLS`) minus osv-scanner, which is Dependencies.
 */
const STAGE_TOOLS: Record<(typeof STAGE_ORDER)[number], string | null> = {
  secrets: null,
  external: 'gitleaks · semgrep · zizmor · trivy',
  supplyChain: 'osv-scanner',
  judge: null,
  hunt: null,
}

/**
 * LUM-1012: one layer of one scan as a checklist item — ✓ checked, – not
 * needed or turned off in settings, ! didn't run (failed, queued, not
 * configured, cut short, or skipped for being over its size limit). Only
 * the name is shown, so every row keeps one width; the state's words ride on
 * the label and tooltip, and a size limit also gets its notice below.
 */
function StageItem({
  stageKey,
  scan,
}: {
  stageKey: (typeof STAGE_ORDER)[number]
  scan: SecurityScanView
}) {
  const intl = useIntl()
  const reasonId = useId()
  const state = scan.stages[stageKey]
  if (!state) return null
  // LUM-1079: a PR too large to scan skipped every layer for size.
  const overCap =
    scan.prTooLarge != null ||
    (stageKey === 'hunt' && scan.huntOverCap != null) ||
    (stageKey === 'judge' && scan.judgeOverCap != null)
  const kind = overCap
    ? 'warn'
    : state === 'RAN'
      ? 'ok'
      : state === 'SKIPPED' || state === 'DISABLED'
        ? 'off'
        : 'warn'
  const name = intl.formatMessage({ id: `securityScan.stage.${stageKey}` })
  const stateWord = intl.formatMessage({
    id: `securityScan.stageState.${
      overCap
        ? 'SKIPPED'
        : state === 'PAUSED' && scan.reviewRateLimited
          ? 'RATE_LIMITED'
          : state
    }`,
  })
  const progress =
    stageKey === 'hunt' && scan.huntProgress
      ? intl.formatMessage(
          { id: 'securityScan.huntProgress' },
          {
            covered: scan.huntProgress.coveredFiles,
            total: scan.huntProgress.totalFiles,
          }
        )
      : null
  // LUM-1012 follow-up: a layer that did not (fully) run says why on hover —
  // and as its accessible description, so it is never hover-only.
  const reason = stageReason(stageKey, scan)
  const reasonText = reason
    ? intl.formatMessage({ id: reason.id }, reason.values)
    : null
  const label = [`${name}: ${stateWord}`, progress].filter(Boolean).join(' · ')
  const Icon = kind === 'ok' ? Check : kind === 'off' ? Minus : AlertCircle
  const tone =
    kind === 'ok'
      ? 'text-success-text'
      : kind === 'off'
        ? 'text-muted-foreground/60'
        : 'text-warning-text'
  const textTone =
    kind === 'warn'
      ? 'text-warning-text'
      : kind === 'off'
        ? 'text-muted-foreground/80'
        : 'text-muted-foreground'
  const stageContent = (
    <>
      <Icon className={`size-3.5 shrink-0 ${tone}`} aria-hidden />
      <span
        aria-hidden
        className={
          reasonText
            ? 'underline decoration-dotted underline-offset-2'
            : undefined
        }
      >
        {name}
      </span>
      {/* Only a partial hunt shows its count: a full one is just ✓ (the
        numbers stay on the label). */}
      {scan.huntProgress &&
      stageKey === 'hunt' &&
      scan.huntProgress.coveredFiles < scan.huntProgress.totalFiles ? (
        <span aria-hidden className='text-muted-foreground'>
          {`${scan.huntProgress.coveredFiles}/${scan.huntProgress.totalFiles}`}
        </span>
      ) : null}
    </>
  )
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-caption ${textTone}`}
    >
      {/* A layer with a reason to give is a real button (focusable, hover /
          focus opens the reason, which is also its accessible description);
          a checked one is a labelled image with its state as a plain hover. */}
      {reasonText ? (
        <StageReasonTooltip text={reasonText}>
          <button
            type='button'
            aria-label={label}
            aria-describedby={reasonId}
            data-testid={`stage-${stageKey}`}
            data-state={overCap ? 'OVER_CAP' : state}
            className='inline-flex cursor-help items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            {stageContent}
          </button>
        </StageReasonTooltip>
      ) : (
        <span
          role='img'
          aria-label={label}
          title={label}
          data-testid={`stage-${stageKey}`}
          data-state={overCap ? 'OVER_CAP' : state}
          className='inline-flex items-center gap-1'
        >
          {stageContent}
        </span>
      )}
      {reasonText ? (
        <span id={reasonId} className='sr-only'>
          {reasonText}
        </span>
      ) : null}
      <StageInfo stageKey={stageKey} name={name} />
    </span>
  )
}

/**
 * LUM-1012 follow-up: the hover on a layer that did not (fully) run — why.
 * A layer that checked the change has nothing to explain and no tooltip.
 */
function StageReasonTooltip({
  text,
  children,
}: {
  text: string | null
  children: ReactElement
}) {
  if (!text) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side='bottom'
        className='max-w-64 text-caption'
        data-testid='stage-reason'
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** LUM-1012 follow-up: the ⓘ next to a layer — what that layer checks. */
function StageInfo({
  stageKey,
  name,
}: {
  stageKey: (typeof STAGE_ORDER)[number]
  name: string
}) {
  const intl = useIntl()
  const tools = STAGE_TOOLS[stageKey]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          data-testid={`layer-info-${stageKey}`}
          aria-label={intl.formatMessage(
            { id: 'securityScan.stageInfo.trigger' },
            { layer: name }
          )}
          className='inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground/70 hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground'
        >
          <Info className='size-3' aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        data-testid={`layer-info-${stageKey}-content`}
        className='w-72 space-y-1.5 p-3 text-caption'
      >
        <p className='text-body-strong text-foreground'>{name}</p>
        <p className='text-foreground/80'>
          {intl.formatMessage({ id: `securityScan.stageInfo.${stageKey}` })}
        </p>
        {tools ? (
          <p className='text-muted-foreground'>
            {intl.formatMessage(
              { id: 'securityScan.stageInfo.tools' },
              { tools }
            )}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * LUM-1012: a scan's result cell. Findings that need nobody's decision —
 * rejected by the verifier, already ruled on, already on main, or out of the
 * queue — never read as "N findings" in the warning tone; the cell says what
 * they are. Everything else is the shared badge.
 */
function ScanResult({ scan }: { scan: SecurityScanView | null }) {
  const intl = useIntl()
  if (scan && scan.findings.length > 0 && scan.findings.every(isQuietFinding)) {
    const dismissed = scan.findings.filter(
      f => f.verifierVerdict === 'REJECTED' && f.disposition === null
    ).length
    return (
      <span
        data-testid='scan-result-quiet'
        className='inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground'
      >
        {dismissed > 0
          ? intl.formatMessage(
              { id: 'securityScan.result.verifierDismissed' },
              { count: dismissed }
            )
          : intl.formatMessage({ id: 'securityScan.result.noOpen' })}
      </span>
    )
  }
  return <SecurityScanBadge scan={scan} />
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
      await securityScanClient.bulkDispositionSecurityFindings(taskId)
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
      {error && <span className='text-caption text-danger-text'>{error}</span>}
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
  const turnedOff = turnedOffLayers(scan.stages)
  return (
    <div className='mt-1.5 space-y-1.5'>
      {scan.codeScrubbed && (
        <p
          data-testid='scan-code-scrubbed'
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage({ id: 'securityScan.codeScrubbed' })}
        </p>
      )}
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
        <p
          data-testid='external-late'
          className='text-caption text-warning-text'
        >
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
        <p
          data-testid='scan-unfinished'
          className='text-caption text-warning-text'
        >
          {intl.formatMessage({ id: 'securityScan.partial' })}
        </p>
      )}
      {/* LUM-832: a layer over its size cap did not run — told plainly
          as a limit on the change: the change is too large, and how to
          get the layer (narrow the scope or split the PR). */}
      {turnedOff.length > 0 && (
        <p
          data-testid='scan-turned-off'
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage(
            { id: 'securityScan.turnedOff' },
            {
              layers: turnedOff
                .map(key =>
                  intl.formatMessage({ id: `securityScan.stage.${key}` })
                )
                .join(', '),
              count: turnedOff.length,
            }
          )}
        </p>
      )}
      {/* LUM-1079: the whole PR was too large to scan — why, and what to
          do (split it or narrow its scope). Never the owned line above. */}
      {scan.prTooLarge && <PrTooLargeNotice tooLarge={scan.prTooLarge} />}
      {scan.huntOverCap && (
        <OverCapNotice
          testId='scan-over-cap'
          size={scan.huntOverCap.sourceFiles}
          cap={scan.huntOverCap.capFiles}
        >
          {intl.formatMessage(
            { id: 'securityScan.huntOverCap' },
            {
              files: scan.huntOverCap.sourceFiles,
              cap: scan.huntOverCap.capFiles,
            }
          )}
        </OverCapNotice>
      )}
      {scan.judgeOverCap && <JudgeOverCapNotice overCap={scan.judgeOverCap} />}
      {scan.judgePartial && <JudgePartialNotice partial={scan.judgePartial} />}
      {externalReason && (
        <p
          data-testid='external-failed-reason'
          className='font-mono text-caption text-muted-foreground'
        >
          {`${intl.formatMessage({ id: 'securityScan.external.failedReason' })} ${externalReason}`}
        </p>
      )}
      {!externalReason &&
        !scan.prTooLarge &&
        scan.error &&
        scan.status === 'FAILED' && (
          <p className='font-mono text-caption text-muted-foreground'>
            {scan.error}
          </p>
        )}
      {/* Findings someone must decide on first; the quiet ones after, each
          reason said once as its group's heading. */}
      {groupFindings(scan.findings).map(group => (
        <div
          key={`${group.key}:${group.queueExit ?? ''}`}
          // Queue exits are split per exit kind, so their id carries the
          // kind — two groups never share one.
          data-testid={
            group.queueExit
              ? `finding-group-queueExit-${group.queueExit}`
              : `finding-group-${group.key}`
          }
          className='space-y-1.5 pt-1'
        >
          <p className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            {`${groupHeading(intl, group)} · ${group.findings.length}`}
          </p>
          {group.findings.map(f => (
            <FindingRow
              key={f.id}
              taskId={taskId}
              prNumber={prNumber}
              finding={f}
              groupKey={group.key}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function groupHeading(
  intl: ReturnType<typeof useIntl>,
  group: FindingGroup
): string {
  if (group.key === 'queueExit' && group.queueExit)
    return intl.formatMessage({
      id: `securityScan.finding.queueExit.${group.queueExit}`,
    })
  if (group.key === 'persisting')
    return intl.formatMessage({ id: 'securityScan.finding.persisting' })
  return intl.formatMessage({ id: `securityScan.group.${group.key}` })
}

/** LUM-832 / LUM-1144 — the AI review did not run: over its size cap. */
function JudgeOverCapNotice({
  overCap,
}: {
  overCap: NonNullable<SecurityScanView['judgeOverCap']>
}) {
  const intl = useIntl()
  // LUM-1144: over by file count alone — the characters fit.
  if (isJudgeOverCapByFiles(overCap))
    return (
      <OverCapNotice
        testId='scan-judge-over-cap'
        size={overCap.files!}
        cap={overCap.capFiles!}
      >
        {intl.formatMessage(
          { id: 'securityScan.judgeOverCapFiles' },
          { files: overCap.files!, cap: overCap.capFiles! }
        )}
      </OverCapNotice>
    )
  return (
    <OverCapNotice
      testId='scan-judge-over-cap'
      size={overCap.diffChars}
      cap={overCap.capChars}
    >
      {intl.formatMessage(
        { id: 'securityScan.judgeOverCap' },
        { size: overCap.diffChars, cap: overCap.capChars }
      )}
    </OverCapNotice>
  )
}

/**
 * LUM-1144 — the AI review read the files within its size cap and skipped
 * the rest: which ones, and how to get them reviewed.
 */
function JudgePartialNotice({
  partial,
}: {
  partial: NonNullable<SecurityScanView['judgePartial']>
}) {
  const intl = useIntl()
  const named = partial.skippedPaths.slice(0, JUDGE_PARTIAL_MAX_NAMED)
  const rest = partial.skippedPaths.length - named.length
  return (
    <div
      data-testid='scan-judge-partial'
      className='space-y-1 rounded-md border border-warning-border bg-warning-subtle px-3 py-2'
    >
      <p className='text-caption text-foreground/80'>
        {intl.formatMessage(
          { id: 'securityScan.judgePartial' },
          {
            reviewed: partial.reviewedFiles,
            total: partial.totalFiles,
            capFiles: partial.capFiles,
            capChars: partial.capChars,
          }
        )}
      </p>
      <ul className='font-mono text-caption text-muted-foreground'>
        {named.map(path => (
          <li key={path} className='truncate'>
            {path}
          </li>
        ))}
        {rest > 0 && (
          <li>
            {intl.formatMessage(
              { id: 'securityScan.judgePartialMore' },
              { count: rest }
            )}
          </li>
        )}
      </ul>
    </div>
  )
}

/**
 * LUM-1079 — the PR was too large to scan at all. Only when the PR is over
 * the file cap is it drawn like the per-layer notices (the change against
 * the cap); a diff GitHub refused under the cap (e.g. over its line limit)
 * has no "how far over" in files, so it gets the message alone.
 */
function PrTooLargeNotice({
  tooLarge,
}: {
  tooLarge: NonNullable<SecurityScanView['prTooLarge']>
}) {
  const intl = useIntl()
  const files = tooLarge.changedFiles
  const message =
    tooLarge.reason === 'FILE_LIMIT' && files !== null
      ? intl.formatMessage(
          { id: 'securityScan.prTooLarge.fileLimit' },
          { files, cap: tooLarge.capFiles }
        )
      : files !== null
        ? intl.formatMessage(
            { id: 'securityScan.prTooLarge.diffRefusedFiles' },
            { files }
          )
        : intl.formatMessage({ id: 'securityScan.prTooLarge.diffRefused' })
  if (files === null || files <= tooLarge.capFiles)
    return (
      <p
        data-testid='scan-pr-too-large'
        className='rounded-md border border-warning-border bg-warning-subtle px-3 py-2 text-caption text-foreground/80'
      >
        {message}
      </p>
    )
  return (
    <OverCapNotice
      testId='scan-pr-too-large'
      size={files}
      cap={tooLarge.capFiles}
    >
      {message}
    </OverCapNotice>
  )
}

/**
 * LUM-1012 follow-up: a layer skipped for being over its size cap — the
 * message plus a bar of the change against the cap, so "how far over" reads
 * at a glance. The bar is decoration; the message carries the numbers.
 */
function OverCapNotice({
  testId,
  size,
  cap,
  children,
}: {
  testId: string
  size: number
  cap: number
  children: ReactNode
}) {
  const capAt = size > 0 ? Math.min(100, (cap / size) * 100) : 100
  return (
    <div
      data-testid={testId}
      className='space-y-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2'
    >
      <p className='text-caption text-foreground/80'>{children}</p>
      <div
        aria-hidden
        className='relative h-1.5 overflow-visible rounded-full bg-warning-border'
      >
        <span
          className='absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-foreground'
          style={{ left: `${capAt}%` }}
        />
      </div>
    </div>
  )
}

function FindingRow({
  taskId,
  prNumber,
  finding,
  groupKey,
}: {
  taskId: string
  prNumber: number
  finding: SecurityFindingView
  /** The group heading this row sits under — its reason chip is not repeated. */
  groupKey?: FindingGroupKey
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Disposition | null>(null)
  // LUM-1128: a ruled finding (e.g. ruled via `lumo finding disposition`)
  // can be corrected here — the panel reopens its controls on demand.
  const [changing, setChanging] = useState(false)
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
  // LUM-988: the agentic verifier read the code and rejected it — kept and
  // shown (muted, with the reason), but not open and not on the PR.
  const verifierRejected =
    finding.verifierVerdict === 'REJECTED' && finding.disposition === null

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
      await securityScanClient.dispositionSecurityFinding(taskId, finding.id, {
        disposition: pending,
        ...(pending !== 'OPEN' && note.trim() ? { note: note.trim() } : {}),
      })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.securityScans(taskId),
      })
      setPending(null)
      setChanging(false)
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
  const muted =
    finding.persisting || finding.queueExit != null || verifierRejected
  // LUM-1012: a quiet finding (nothing to decide) is one line until opened —
  // its reasons and evidence are there for whoever wants to check.
  const quiet = isQuietFinding(finding)
  const [open, setOpen] = useState(!quiet)
  const severityTone =
    finding.severity === 'HIGH' && !muted
      ? 'text-danger-text'
      : 'text-muted-foreground'

  return (
    <div
      data-testid={`security-finding-${finding.id}`}
      data-blocking={finding.blocking}
      data-persisting={finding.persisting}
      data-queue-exit={finding.queueExit ?? undefined}
      className={`rounded-md border border-border bg-background px-2.5 py-2${
        muted && !open ? ' opacity-60' : ''
      }`}
    >
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption'>
        {quiet ? (
          <button
            type='button'
            aria-expanded={open}
            data-testid='finding-toggle'
            onClick={() => setOpen(o => !o)}
            className='flex flex-wrap items-center gap-x-2 text-left'
          >
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            />
            <FindingHeadline finding={finding} tone={severityTone} />
          </button>
        ) : (
          <FindingHeadline finding={finding} tone={severityTone} />
        )}
        {/* Folded, a quiet finding keeps only why it is quiet (the chips
            below); its kind and source come back when opened. */}
        {open ? (
          <>
            {finding.kind !== 'DEPENDENCY' && (
              <span
                data-testid='finding-kind'
                className='text-muted-foreground'
              >
                {intl.formatMessage({
                  id: `securityScan.kind.${finding.kind}`,
                })}
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
              <span className='font-mono text-muted-foreground'>
                {finding.cwe}
              </span>
            )}
            {suggestedOpen && (
              <span
                data-testid='finding-suggested'
                className='rounded-sm border border-warning/40 px-1 text-warning-text'
              >
                {intl.formatMessage({
                  id: 'securityScan.suggested.falsePositive',
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
          </>
        ) : null}
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
        {finding.persisting && groupKey !== 'persisting' && (
          <span
            data-testid='finding-persisting'
            className='rounded-sm bg-muted px-1 text-muted-foreground'
          >
            {intl.formatMessage({ id: 'securityScan.finding.persisting' })}
          </span>
        )}
        {finding.queueExit && groupKey !== 'queueExit' && (
          <span
            data-testid='finding-queue-exit'
            className='rounded-sm bg-muted px-1 text-muted-foreground'
          >
            {intl.formatMessage({
              id: `securityScan.finding.queueExit.${finding.queueExit}`,
            })}
          </span>
        )}
        {verifierRejected && groupKey !== 'verifierRejected' && (
          <span
            data-testid='finding-verifier-rejected'
            className='rounded-sm bg-muted px-1 text-muted-foreground'
          >
            {intl.formatMessage({ id: 'securityScan.verifier.rejected' })}
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
      {open ? (
        <>
          <p className='mt-1 text-caption text-foreground/80'>
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
          {verifierRejected && finding.verifierReason && (
            <div
              data-testid='finding-verifier-reason'
              className='mt-1.5 rounded-sm bg-muted px-2 py-1.5 text-caption'
            >
              <span className='block text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                {intl.formatMessage({
                  id: 'securityScan.verifier.reasonLabel',
                })}
              </span>
              <span className='text-foreground/80'>
                {finding.verifierReason}
              </span>
            </div>
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
            <pre className='mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-muted/40 px-2 py-1.5 font-mono text-caption text-foreground/80'>
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
          {finding.disposition && !changing && (
            <div className='mt-2 flex flex-wrap items-center gap-1.5'>
              <button
                type='button'
                data-testid='finding-change-ruling'
                onClick={() => setChanging(true)}
                className={ACTION_BUTTON}
              >
                {intl.formatMessage({ id: 'securityScan.action.changeRuling' })}
              </button>
            </div>
          )}
          {(!finding.disposition || changing) && (
            <div className='mt-2 flex flex-wrap items-center gap-1.5'>
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
                    className={`${ACTION_BUTTON} inline-flex items-center gap-1`}
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
                  {finding.disposition !== 'FALSE_POSITIVE' && (
                    <button
                      type='button'
                      onClick={() => setPending('FALSE_POSITIVE')}
                      className={ACTION_BUTTON}
                    >
                      {intl.formatMessage({
                        id: 'securityScan.action.falsePositive',
                      })}
                    </button>
                  )}
                  {finding.disposition !== 'ACCEPTED_RISK' && (
                    <button
                      type='button'
                      onClick={() => setPending('ACCEPTED_RISK')}
                      className={ACTION_BUTTON}
                    >
                      {intl.formatMessage({
                        id: 'securityScan.action.acceptRisk',
                      })}
                    </button>
                  )}
                  {finding.disposition && (
                    // LUM-1128 follow-up: revert a mistaken ruling (e.g. a
                    // CLI one) — the finding is open again and, if policy
                    // says so, blocks DONE again. Web only.
                    <button
                      type='button'
                      data-testid='finding-reopen'
                      onClick={() => setPending('OPEN')}
                      className={ACTION_BUTTON}
                    >
                      {intl.formatMessage({
                        id: 'securityScan.action.reopen',
                      })}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {pending === 'OPEN' ? (
                    <span className='text-caption text-muted-foreground'>
                      {intl.formatMessage({
                        id: 'securityScan.action.reopenConfirm',
                      })}
                    </span>
                  ) : (
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
                  )}
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
                      setChanging(false)
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
        </>
      ) : null}
      {error && (
        <p
          data-testid='finding-disposition-error'
          className='mt-0.5 text-caption text-danger-text'
        >
          {error}
        </p>
      )}
    </div>
  )
}

const ACTION_BUTTON =
  'h-7 rounded-md border border-border bg-background px-2.5 text-caption text-foreground hover:bg-muted'

/** Severity · title · file:line — the part of a finding row that is always shown. */
function FindingHeadline({
  finding,
  tone,
}: {
  finding: SecurityFindingView
  tone: string
}) {
  const intl = useIntl()
  return (
    <>
      <span className={`font-medium uppercase ${tone}`}>
        {intl.formatMessage({
          id: `securityScan.severity.${finding.severity}`,
        })}
      </span>
      <span className='text-foreground'>{finding.title}</span>
      <span className='font-mono text-muted-foreground'>
        {finding.filePath}
        {finding.line != null ? `:${finding.line}` : ''}
      </span>
    </>
  )
}
