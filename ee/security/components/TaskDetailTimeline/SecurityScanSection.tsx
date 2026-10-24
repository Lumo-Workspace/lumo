'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Info,
  Loader2,
  Minus,
  MoreHorizontal,
} from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  isJudgeOverCapByFiles,
  turnedOffLayers,
  type ScanStageKeyName,
} from '@/shared/src/security-scan'
// Pure module (no Node built-ins, no Prisma) — safe in a client component.
import { EXTERNAL_ERROR_PREFIX } from '@/ee/security/security-scan/stages'
import {
  blockingFindings,
  groupFindings,
  isQuietFinding,
  stageReason,
  type FindingGroup,
  type FindingGroupKey,
} from './security-summary'
import { buildCheckRows, orderPrs, type CheckRow } from './lumo-review-checks'
import { buildAgentContext } from './security-agent-context'
import { RewardHackEvidence } from './RewardHackEvidence'
import {
  Collapsible,
  CollapsibleCard,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { securityScanClient } from '@/ee/security/api-client'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { nonPassingChecks } from '@/shared/src/pre-merge-checks'

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
    <Card
      data-testid='security-blocking-findings'
      className='overflow-hidden border-danger-border'
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
            <FindingRow
              taskId={taskId}
              prNumber={prNumber}
              prUrl={data?.prs.find(p => p.pr.number === prNumber)?.pr.url}
              finding={finding}
            />
          </div>
        ))}
      </div>
    </Card>
  )
}

type PrEntry = TaskSecurityScans['prs'][number]

/**
 * LUM-1308 — the Lumo review record. Task-level notes first (bulk confirm,
 * the blocking line, scanning turned off); then the PRs: one PR is shown as
 * is, two sit in tabs, three or more are listed by how much they need a look
 * with the clean ones folded into one row. Each PR reads as its six checks.
 */
function SecurityScanPanel({
  taskId,
  data,
}: {
  taskId: string
  data: TaskSecurityScans
}) {
  const intl = useIntl()
  const scanned = data.prs.some(p => p.latest !== null)
  return (
    // LUM-1009/1012: the Record tab's row carries the title and the verdict.
    <div data-testid='security-scan-panel' className='space-y-3'>
      {(data.suggested?.count ?? 0) > 0 && (
        <ConfirmAllSuggested taskId={taskId} count={data.suggested.count} />
      )}
      {data.blocking.count > 0 && (
        <Alert
          variant='danger'
          size='sm'
          role='note'
          data-testid='security-blocking-banner'
        >
          <AlertCircle aria-hidden />
          <p>
            {intl.formatMessage(
              { id: 'securityScan.banner.blocking' },
              { count: data.blocking.count }
            )}
          </p>
        </Alert>
      )}
      {/* LUM-892: scanning turned off in settings — said up front, so the
          results below read as "from before", not as the PR's answer. */}
      {data.scanningOff && (
        <p
          data-testid='security-scanning-off'
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage({
            id: scanned
              ? 'securityScan.banner.scanningOff'
              : 'securityScan.section.scanningOff',
          })}
        </p>
      )}
      {!scanned ? (
        data.scanningOff ? null : (
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'securityScan.section.empty' })}
          </p>
        )
      ) : data.prs.length === 1 ? (
        <PrReport
          taskId={taskId}
          entry={data.prs[0]!}
          scanningOff={data.scanningOff}
        />
      ) : data.prs.length === 2 ? (
        <PrTabs taskId={taskId} prs={data.prs} scanningOff={data.scanningOff} />
      ) : (
        <PrList taskId={taskId} prs={data.prs} scanningOff={data.scanningOff} />
      )}
    </div>
  )
}

/** The PR's icon: merged, or open / closed. */
function PrIcon({ state }: { state: string }) {
  const Icon = state === 'merged' ? GitMerge : GitPullRequest
  return <Icon className='size-4 shrink-0' aria-hidden />
}

/** `#n title` — a PR's name in a tab or list row. */
function PrName({ pr }: { pr: PrEntry['pr'] }) {
  return (
    <>
      <PrIcon state={pr.state} />
      <span className='shrink-0 font-mono text-caption font-normal text-muted-foreground'>
        #{pr.number}
      </span>
      <span className='min-w-0 truncate'>{pr.title}</span>
    </>
  )
}

/** Two PRs: tabs in attention order, so the selected one is also first. */
function PrTabs({
  taskId,
  prs,
  scanningOff,
}: {
  taskId: string
  prs: PrEntry[]
  scanningOff: boolean
}) {
  const { listed, clean } = orderPrs(prs)
  const ordered = [...listed, ...clean]
  return (
    <Tabs defaultValue={ordered[0]!.pr.id}>
      <TabsList className='grid h-auto w-full grid-cols-2'>
        {ordered.map(({ pr }) => (
          <TabsTrigger
            key={pr.id}
            value={pr.id}
            data-testid={`security-pr-${pr.number}-toggle`}
            className='min-w-0 gap-1.5'
          >
            <PrName pr={pr} />
          </TabsTrigger>
        ))}
      </TabsList>
      {ordered.map(entry => (
        <TabsContent key={entry.pr.id} value={entry.pr.id} className='mt-3'>
          <PrReport taskId={taskId} entry={entry} scanningOff={scanningOff} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

/**
 * Three or more PRs: one accordion row each, in attention order, the first
 * open; PRs with nothing to do fold into one row at the end.
 */
function PrList({
  taskId,
  prs,
  scanningOff,
}: {
  taskId: string
  prs: PrEntry[]
  scanningOff: boolean
}) {
  const intl = useIntl()
  const { listed, clean } = orderPrs(prs)
  return (
    <div className='divide-y divide-border border-y border-border'>
      {listed.map((entry, i) => (
        <PrListRow
          key={entry.pr.id}
          taskId={taskId}
          entry={entry}
          scanningOff={scanningOff}
          defaultOpen={i === 0}
        />
      ))}
      {clean.length > 0 && (
        <Collapsible data-testid='security-pr-clean'>
          <CollapsibleTrigger className='flex min-h-12 w-full items-center gap-2 text-left text-body text-muted-foreground'>
            <GitPullRequest className='size-4 shrink-0' aria-hidden />
            <span className='min-w-0 flex-1 truncate'>
              {intl.formatMessage(
                { id: 'lumoReview.pr.moreClean' },
                { count: clean.length }
              )}
            </span>
            <Badge variant='success' size='sm'>
              {intl.formatMessage({ id: 'securityScan.status.CLEAN' })}
            </Badge>
            <ChevronDown
              className='size-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-180'
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className='divide-y divide-border border-t border-border pl-6'>
              {clean.map(entry => (
                <PrListRow
                  key={entry.pr.id}
                  taskId={taskId}
                  entry={entry}
                  scanningOff={scanningOff}
                  defaultOpen={false}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function PrListRow({
  taskId,
  entry,
  scanningOff,
  defaultOpen,
}: {
  taskId: string
  entry: PrEntry
  scanningOff: boolean
  defaultOpen: boolean
}) {
  const { pr, latest } = entry
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        data-testid={`security-pr-${pr.number}-toggle`}
        className='flex min-h-12 w-full items-center gap-2 text-left text-body-strong text-foreground'
      >
        <PrName pr={pr} />
        <span className='flex-1' />
        <span className='shrink-0'>
          {scanningOff && showsScanningOff(latest) ? (
            <ScanningOffBadge />
          ) : (
            <ScanResult scan={latest} />
          )}
        </span>
        <ChevronDown
          className='size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180'
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='pb-3 pl-6'>
          <PrReport
            taskId={taskId}
            entry={entry}
            scanningOff={scanningOff}
            showResult={false}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * One PR's report: a header (link, commit, result, review actions), the
 * notes that concern the whole scan, then one row per check.
 */
function PrReport({
  taskId,
  entry,
  scanningOff,
  showResult = true,
}: {
  taskId: string
  entry: PrEntry
  scanningOff: boolean
  showResult?: boolean
}) {
  const intl = useIntl()
  const { pr, latest, reviewControl } = entry
  return (
    <div data-testid={`security-pr-${pr.number}`} className='space-y-2'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <a
          href={pr.url}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-1 text-body-strong text-foreground underline-offset-2 hover:underline'
        >
          {intl.formatMessage(
            { id: 'lumoReview.pr.view' },
            { number: pr.number }
          )}
          <ExternalLink className='size-3' aria-hidden />
        </a>
        {latest && (
          <span
            title={intl.formatMessage(
              { id: 'securityScan.meta' },
              { sha: latest.headSha.slice(0, 7) }
            )}
            className='font-mono text-caption text-muted-foreground'
          >
            {latest.headSha.slice(0, 7)}
          </span>
        )}
        {showResult && (
          <span className='shrink-0'>
            {scanningOff && showsScanningOff(latest) ? (
              <ScanningOffBadge />
            ) : (
              <ScanResult scan={latest} />
            )}
          </span>
        )}
        <span className='flex-1' />
        {pr.repo && pr.state === 'open' && (
          <ReviewControls
            taskId={taskId}
            number={pr.number}
            repo={pr.repo}
            scan={latest}
            {...(reviewControl ? { control: reviewControl } : {})}
          />
        )}
      </div>
      {pr.headSha && latest && pr.headSha !== latest.headSha && (
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'securityScan.review.stale' })}
        </p>
      )}
      {latest && (
        <>
          <ScanNotices scan={latest} />
          <ul className='divide-y divide-border'>
            {buildCheckRows(latest).map(row => (
              <CheckRowView
                key={row.key}
                taskId={taskId}
                pr={pr}
                scan={latest}
                row={row}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** The workspace's API-keys page, for the "set up your scanner" link. */
function useApiKeysHref(): string {
  const pathname = usePathname()
  const workspaceSlug = pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? null
  return workspaceSlug ? `/workspace/${workspaceSlug}/settings/api-keys` : '#'
}

/**
 * What concerns the whole scan rather than one check: pre-merge checks,
 * cleared code, fixes since the last scan, our own unfinished work, layers
 * turned off, a PR too large to scan, and a failed scan's error.
 */
function ScanNotices({ scan }: { scan: SecurityScanView }) {
  const intl = useIntl()
  const turnedOff = turnedOffLayers(scan.stages)
  return (
    <div className='space-y-1.5 empty:hidden'>
      {nonPassingChecks(scan.preMergeChecks).map(check => (
        <Alert
          key={check.id}
          variant='warning'
          size='sm'
          role='note'
          data-testid='pre-merge-check'
          className='gap-y-0.5'
        >
          <p className='text-body-strong'>
            {check.name} ·{' '}
            {intl.formatMessage({
              id: `securityScan.preMerge.${check.verdict}`,
            })}
          </p>
          {check.explanation ? <p>{check.explanation}</p> : null}
          {check.resolution ? <p>{check.resolution}</p> : null}
          {check.requirements
            ?.filter(r => r.outcome !== 'addressed')
            .map(r => (
              <p key={r.id}>
                {r.label} ·{' '}
                {intl.formatMessage({
                  id: `securityScan.preMerge.${r.outcome}`,
                })}
                {r.quotable && r.text ? `: ${r.text}` : ''}
                {r.quotable && r.explanation ? ` — ${r.explanation}` : ''}
              </p>
            ))}
        </Alert>
      ))}
      {/* LUM-1079: the whole PR was too large to scan — why, and what to
          do (split it or narrow its scope). */}
      {scan.prTooLarge && <PrTooLargeNotice tooLarge={scan.prTooLarge} />}
      {/* LUM-832: one owned line, whatever the cause; the check rows say
          which layer did not finish. */}
      {scan.ownedUnfinished && (
        <p
          data-testid='scan-unfinished'
          className='text-caption text-warning-text'
        >
          {intl.formatMessage({ id: 'securityScan.partial' })}
        </p>
      )}
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
                  intl.formatMessage({ id: `lumoReview.check.${key}` })
                )
                .join(', '),
              count: turnedOff.length,
            }
          )}
        </p>
      )}
      {/* Unless the scanner's own reason already says it, under its check. */}
      {!scan.prTooLarge &&
        scan.error &&
        scan.status === 'FAILED' &&
        !(
          scan.stages.external === 'FAILED' &&
          scan.error.startsWith(EXTERNAL_ERROR_PREFIX)
        ) && (
          <p className='font-mono text-caption text-muted-foreground'>
            {scan.error}
          </p>
        )}
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
    </div>
  )
}

/** The short result on a check's row: what it found, or why it didn't run. */
function checkResult(
  intl: ReturnType<typeof useIntl>,
  row: CheckRow,
  scan: SecurityScanView
): { text: string; tone: string } {
  const msg = (id: string, values?: Record<string, number>) =>
    intl.formatMessage({ id: `lumoReview.result.${id}` }, values)
  if (row.open.length > 0)
    return {
      text: msg('found', { count: row.open.length }),
      tone: row.open.some(f => f.blocking)
        ? 'text-danger-text'
        : 'text-foreground',
    }
  const hunt = row.key === 'hunt' ? scan.huntProgress : null
  const huntShort = hunt != null && hunt.coveredFiles < hunt.totalFiles
  const warn = 'text-warning-text'
  const muted = 'text-muted-foreground'
  if (row.overCap) {
    if (row.key === 'judge' && scan.judgePartial)
      return {
        text: msg('files', {
          covered: scan.judgePartial.reviewedFiles,
          total: scan.judgePartial.totalFiles,
        }),
        tone: warn,
      }
    return { text: msg('tooLarge'), tone: warn }
  }
  if (huntShort && (row.state === 'RAN' || row.state === 'PENDING'))
    return {
      text: msg('files', {
        covered: hunt.coveredFiles,
        total: hunt.totalFiles,
      }),
      tone: muted,
    }
  // LUM-1308: a scanner 30 minutes late is not "scanning" any more.
  if (row.key === 'external' && scan.externalLate)
    return { text: msg('late'), tone: warn }
  switch (row.state) {
    case 'RAN':
      return { text: msg('nothingFound'), tone: muted }
    case 'SKIPPED':
      return { text: msg('notNeeded'), tone: muted }
    case 'DISABLED':
      return { text: msg('offInSettings'), tone: muted }
    case 'PENDING':
      return { text: msg('scanning'), tone: muted }
    case 'NOT_CONFIGURED':
      return { text: msg('off'), tone: warn }
    case 'FAILED':
      return { text: msg('didntFinish'), tone: warn }
    case 'PARTIAL':
      return { text: msg('partlyChecked'), tone: warn }
    case 'SUPERSEDED':
      return { text: msg('superseded'), tone: warn }
    case 'PAUSED':
      return {
        text: msg(
          scan.reviewIgnored
            ? 'ignored'
            : scan.reviewRateLimited
              ? 'rateLimited'
              : 'paused'
        ),
        tone: warn,
      }
    default:
      return { text: msg('notRecorded'), tone: muted }
  }
}

/** The notices that belong to one check (size limits, the scanner's state). */
function CheckNotices({
  checkKey,
  scan,
}: {
  checkKey: CheckRow['key']
  scan: SecurityScanView
}) {
  const intl = useIntl()
  const apiKeysHref = useApiKeysHref()
  // P8: `error` has two writers — only the prefixed one (the ingest
  // workflow's scrubbed reason) may be shown, and only after the prefix.
  const externalReason =
    scan.stages.external === 'FAILED' &&
    scan.error?.startsWith(EXTERNAL_ERROR_PREFIX)
      ? scan.error.slice(EXTERNAL_ERROR_PREFIX.length)
      : null
  if (checkKey === 'judge')
    return (
      <>
        {scan.judgeOverCap && (
          <JudgeOverCapNotice overCap={scan.judgeOverCap} />
        )}
        {scan.judgePartial && (
          <JudgePartialNotice partial={scan.judgePartial} />
        )}
      </>
    )
  if (checkKey === 'hunt' && scan.huntOverCap)
    return (
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
    )
  if (checkKey !== 'external') return null
  return (
    <>
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
      {externalReason && (
        <p
          data-testid='external-failed-reason'
          className='font-mono text-caption text-muted-foreground'
        >
          {`${intl.formatMessage({ id: 'securityScan.external.failedReason' })} ${externalReason}`}
        </p>
      )}
    </>
  )
}

/** Whether `CheckNotices` draws anything for this check — mirrors it. */
function hasCheckNotices(
  checkKey: CheckRow['key'],
  scan: SecurityScanView
): boolean {
  if (checkKey === 'judge')
    return scan.judgeOverCap != null || scan.judgePartial != null
  if (checkKey === 'hunt') return scan.huntOverCap != null
  if (checkKey !== 'external') return false
  return (
    scan.externalLate ||
    scan.stages.external === 'NOT_CONFIGURED' ||
    (scan.stages.external === 'FAILED' &&
      (scan.error?.startsWith(EXTERNAL_ERROR_PREFIX) ?? false))
  )
}

/**
 * Checks whose findings come in more than one kind — the category badge
 * tells them apart (AI review: bugs and vulnerabilities; code scan: leaked
 * credentials, insecure patterns and graph rules). Elsewhere the check's
 * name already says the kind.
 */
const MIXED_KIND_CHECKS: ReadonlySet<CheckRow['key']> = new Set([
  'judge',
  'external',
])

/**
 * LUM-1308 — one check as a row: state icon, plain name, short result, and
 * (when there is anything to show) a fold with why it didn't fully run, the
 * findings to decide on, and the quiet ones folded per reason. Opens by
 * default when a finding needs a decision or the check didn't cover the PR.
 */
function CheckRowView({
  taskId,
  pr,
  scan,
  row,
}: {
  taskId: string
  pr: PrEntry['pr']
  scan: SecurityScanView
  row: CheckRow
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(row.defaultOpen)
  // A row that gains a reason to open (a new finding, a layer that stopped
  // covering the PR) opens on refresh. Losing the reason never closes it —
  // a human who just ruled on the last finding keeps seeing the result.
  const [openedFor, setOpenedFor] = useState(row.defaultOpen)
  if (row.defaultOpen !== openedFor) {
    setOpenedFor(row.defaultOpen)
    if (row.defaultOpen) setOpen(true)
  }
  const name = intl.formatMessage({ id: `lumoReview.check.${row.key}` })
  const result = checkResult(intl, row, scan)
  const notices = hasCheckNotices(row.key, scan)
  // Why a check did not (fully) run — said in the fold, unless a notice
  // above already says it with its numbers.
  const reason =
    row.tone === 'ok' || notices ? null : stageReason(row.key, scan)
  const reasonText = reason
    ? intl.formatMessage({ id: reason.id }, reason.values)
    : null
  const expandable =
    row.open.length > 0 || row.quiet.length > 0 || notices || reasonText != null
  const Icon =
    row.tone === 'ok'
      ? Check
      : row.tone === 'off'
        ? Minus
        : row.tone === 'pending'
          ? Loader2
          : AlertCircle
  const iconTone =
    row.tone === 'ok'
      ? 'text-success-text'
      : row.tone === 'warn'
        ? 'text-warning-text'
        : 'text-muted-foreground'
  const label = `${name}: ${result.text}`
  const content = (
    <>
      <Icon
        className={`size-4 shrink-0 ${iconTone}${
          row.tone === 'pending' ? ' animate-spin' : ''
        }`}
        aria-hidden
      />
      <span
        className={`min-w-0 flex-1 truncate text-body-strong ${
          row.tone === 'off' ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {name}
      </span>
      <span className={`shrink-0 text-body ${result.tone}`}>{result.text}</span>
    </>
  )
  return (
    <Collapsible asChild open={expandable && open} onOpenChange={setOpen}>
      <li
        data-testid={`stage-${row.key}`}
        // Not `data-state`: Collapsible's root sets that to open/closed.
        data-check-state={row.overCap ? 'OVER_CAP' : (row.state ?? 'NONE')}
        data-tone={row.tone}
      >
        <div className='flex items-center gap-1'>
          {expandable ? (
            <CollapsibleTrigger
              aria-label={label}
              data-testid={`check-${row.key}-toggle`}
              className='flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left'
            >
              {content}
              <ChevronDown
                className='size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180'
                aria-hidden
              />
            </CollapsibleTrigger>
          ) : (
            <div
              role='group'
              aria-label={label}
              className='flex min-h-11 min-w-0 flex-1 items-center gap-2.5'
            >
              {content}
              <span className='size-4 shrink-0' aria-hidden />
            </div>
          )}
          <StageInfo stageKey={row.key} name={name} />
        </div>
        {expandable && (
          <CollapsibleContent>
            <div className='space-y-2 pb-3 pl-6.5'>
              {reasonText && (
                <p
                  data-testid='check-reason'
                  className='text-caption text-muted-foreground'
                >
                  {reasonText}
                </p>
              )}
              <CheckNotices checkKey={row.key} scan={scan} />
              {row.open.map(f => (
                <FindingRow
                  key={f.id}
                  taskId={taskId}
                  prNumber={pr.number}
                  prUrl={pr.url}
                  finding={f}
                  showKind={MIXED_KIND_CHECKS.has(row.key)}
                />
              ))}
              {groupFindings(row.quiet).map(group => (
                <QuietGroup
                  key={`${group.key}:${group.queueExit ?? ''}`}
                  taskId={taskId}
                  pr={pr}
                  group={group}
                />
              ))}
            </div>
          </CollapsibleContent>
        )}
      </li>
    </Collapsible>
  )
}

/** Findings nobody has to decide on now, folded under their reason. */
function QuietGroup({
  taskId,
  pr,
  group,
}: {
  taskId: string
  pr: PrEntry['pr']
  group: FindingGroup
}) {
  const intl = useIntl()
  return (
    <Collapsible
      data-testid={
        group.queueExit
          ? `finding-group-queueExit-${group.queueExit}`
          : `finding-group-${group.key}`
      }
    >
      <CollapsibleTrigger className='inline-flex h-control-sm items-center gap-1.5 rounded-md px-2 -ml-2 text-body text-muted-foreground hover:bg-accent hover:text-accent-foreground'>
        <ChevronRight
          className='size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90'
          aria-hidden
        />
        {`${groupHeading(intl, group)} · ${group.findings.length}`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='space-y-2 pt-1'>
          {group.findings.map(f => (
            <FindingRow
              key={f.id}
              taskId={taskId}
              prNumber={pr.number}
              prUrl={pr.url}
              finding={f}
              groupKey={group.key}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
  // LUM-1308: the review actions sit behind one ⋯ menu on the PR's header;
  // the reviewed-commit count is the menu's label.
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size='icon-sm'
            disabled={busy}
            aria-label={intl.formatMessage({ id: 'lumoReview.reviewActions' })}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {control && (
            <DropdownMenuLabel className='text-caption font-normal text-muted-foreground'>
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
            </DropdownMenuLabel>
          )}
          <DropdownMenuItem onSelect={() => void act('incremental')}>
            {intl.formatMessage({ id: 'securityScan.review.incremental' })}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void act('full')}>
            {intl.formatMessage({ id: 'securityScan.review.full' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {!control?.paused && (
            <DropdownMenuItem onSelect={() => void act('pause')}>
              {intl.formatMessage({ id: 'securityScan.review.pause' })}
            </DropdownMenuItem>
          )}
          {(control?.paused || !control) && (
            <DropdownMenuItem onSelect={() => void act('resume')}>
              {intl.formatMessage({ id: 'securityScan.review.resume' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span role='alert' className='text-caption text-danger-text'>
          {intl.formatMessage({ id: 'securityScan.review.error' })}
        </span>
      )}
      {queued && (
        <span role='status' className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'securityScan.review.queued' })}
        </span>
      )}
    </div>
  )
}

/**
 * The scanners behind each layer, named in its ⓘ card. Product names, not
 * copy — never translated. Code scan's are the managed scan's tools
 * (`MANAGED_SCAN_TOOLS`) minus osv-scanner, which is Dependencies.
 */
const STAGE_TOOLS: Record<ScanStageKeyName, string | null> = {
  secrets: null,
  external: 'gitleaks · semgrep · zizmor · trivy',
  supplyChain: 'osv-scanner',
  judge: null,
  rewardHack: null,
  hunt: null,
}

/** LUM-1012 follow-up: the ⓘ next to a layer — what that layer checks. */
function StageInfo({
  stageKey,
  name,
}: {
  stageKey: ScanStageKeyName
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
  const checks = nonPassingChecks(scan?.preMergeChecks)
  // LUM-1298: the finding scan's own result stays (it may be Clean), but a
  // warned or failed pre-merge check rides next to it — never a bare Clean.
  if (checks.length === 0) return <FindingsResult scan={scan} />
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <FindingsResult scan={scan} />
      <Badge data-testid='scan-result-pre-merge' variant='warning' size='sm'>
        {intl.formatMessage(
          { id: 'record.security.preMergeNotPassed' },
          { count: checks.length }
        )}
      </Badge>
    </div>
  )
}

function FindingsResult({ scan }: { scan: SecurityScanView | null }) {
  const intl = useIntl()
  if (scan && scan.findings.length > 0 && scan.findings.every(isQuietFinding)) {
    const dismissed = scan.findings.filter(
      f => f.verifierVerdict === 'REJECTED' && f.disposition === null
    ).length
    return (
      <Badge data-testid='scan-result-quiet' variant='muted' size='sm'>
        {dismissed > 0
          ? intl.formatMessage(
              { id: 'securityScan.result.verifierDismissed' },
              { count: dismissed }
            )
          : intl.formatMessage({ id: 'securityScan.result.noOpen' })}
      </Badge>
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
      <Button
        type='button'
        variant='outline'
        size='sm'
        data-testid='security-confirm-all-suggested'
        disabled={submitting}
        onClick={confirmAll}
      >
        {intl.formatMessage(
          { id: 'securityScan.action.confirmAllSuggested' },
          { count }
        )}
      </Button>
      {error && <span className='text-caption text-danger-text'>{error}</span>}
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
    <Alert
      variant='warning'
      size='sm'
      role='note'
      data-testid='scan-judge-partial'
      className='gap-y-1'
    >
      <p>
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
    </Alert>
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
      <Alert
        variant='warning'
        size='sm'
        role='note'
        data-testid='scan-pr-too-large'
      >
        <p>{message}</p>
      </Alert>
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
    <Alert
      variant='warning'
      size='sm'
      role='note'
      data-testid={testId}
      className='gap-y-2'
    >
      <p>{children}</p>
      <div
        aria-hidden
        className='relative h-1.5 overflow-visible rounded-full bg-warning-border'
      >
        <span
          className='absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-foreground'
          style={{ left: `${capAt}%` }}
        />
      </div>
    </Alert>
  )
}

function FindingRow({
  taskId,
  prNumber,
  prUrl,
  finding,
  groupKey,
  showKind = true,
}: {
  taskId: string
  prNumber: number
  /** The PR's page — the file:line links to its changed files. */
  prUrl?: string | undefined
  finding: SecurityFindingView
  /** The group heading this row sits under — its reason chip is not repeated. */
  groupKey?: FindingGroupKey
  /** LUM-1308: the category badge. Off under a check that only finds one
   *  kind, where the check's name already says it. */
  showKind?: boolean
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
    <CollapsibleCard
      open={open}
      onOpenChange={setOpen}
      data-testid={`security-finding-${finding.id}`}
      data-blocking={finding.blocking}
      data-persisting={finding.persisting}
      data-queue-exit={finding.queueExit ?? undefined}
      className={
        quiet
          ? `rounded-md px-2.5 py-2${muted && !open ? ' opacity-60' : ''}`
          : 'space-y-2 p-3'
      }
    >
      {/* LUM-1308: a finding to decide on is a card — its title, then its
          severity, category and where it is. */}
      {!quiet && (
        <div className='space-y-1.5'>
          <p className='text-body-strong text-foreground'>{finding.title}</p>
          <div className='flex flex-wrap items-center gap-1.5'>
            <Badge
              data-testid='finding-severity'
              variant={
                finding.severity === 'HIGH'
                  ? 'danger'
                  : finding.severity === 'MEDIUM'
                    ? 'warning'
                    : 'muted'
              }
              size='sm'
            >
              {intl.formatMessage({
                id: `securityScan.severity.${finding.severity}`,
              })}
            </Badge>
            {showKind && finding.kind !== 'DEPENDENCY' && (
              <Badge data-testid='finding-kind' variant='outline' size='sm'>
                {intl.formatMessage({
                  id: `securityScan.kind.${finding.kind}`,
                })}
              </Badge>
            )}
            {suggestedOpen && (
              <Badge
                data-testid='finding-suggested'
                variant='outline-muted'
                size='sm'
              >
                {intl.formatMessage({
                  id: 'securityScan.suggested.falsePositive',
                })}
              </Badge>
            )}
            <FindingLocation finding={finding} prUrl={prUrl} />
          </div>
        </div>
      )}
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption empty:hidden'>
        {quiet && (
          <CollapsibleTrigger
            data-testid='finding-toggle'
            className='flex flex-wrap items-center gap-x-2 text-left'
          >
            <ChevronRight
              className='size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90'
              aria-hidden
            />
            <FindingHeadline finding={finding} tone={severityTone} />
          </CollapsibleTrigger>
        )}
        {/* Folded, a quiet finding keeps only why it is quiet (the chips
            below); its kind and source come back when opened. An open
            finding already shows its kind on the card header. */}
        {open ? (
          <>
            {quiet && finding.kind !== 'DEPENDENCY' && (
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
            {quiet && suggestedOpen && (
              <Badge
                data-testid='finding-suggested'
                variant='warning'
                size='xs'
                shape='square'
              >
                {intl.formatMessage({
                  id: 'securityScan.suggested.falsePositive',
                })}
              </Badge>
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
      <CollapsibleContent>
        {/* LUM-1234: a REWARD_HACK row's detail is model prose, served
              only by its evidence view (session access checked). */}
        {finding.detail !== '' && (
          <p className='mt-1 text-caption text-foreground/80'>
            {finding.detail}
          </p>
        )}
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
            <span className='block text-caption uppercase text-muted-foreground'>
              {intl.formatMessage({
                id: 'securityScan.verifier.reasonLabel',
              })}
            </span>
            <span className='text-foreground/80'>{finding.verifierReason}</span>
          </div>
        )}
        {finding.callChain && finding.callChain.length > 0 && (
          <Collapsible className='mt-0.5'>
            <CollapsibleTrigger className='text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground'>
              {intl.formatMessage({ id: 'securityScan.callChain' })}
            </CollapsibleTrigger>
            <CollapsibleContent asChild>
              <ol
                data-testid='finding-call-chain'
                className='mt-0.5 space-y-0.5 font-mono text-caption text-muted-foreground'
              >
                {finding.callChain.map((edge, i) => (
                  <li key={i}>{`${edge.from} → ${edge.to}`}</li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        )}
        {/* LUM-1234: a REWARD_HACK row's `evidence` is event ids — its
              evidence is read from the server, with session access checked. */}
        {finding.kind === 'REWARD_HACK' && (
          <RewardHackEvidence taskId={taskId} findingId={finding.id} />
        )}
        {finding.kind !== 'REWARD_HACK' && finding.evidence !== '' && (
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
            <Button
              type='button'
              data-testid='finding-change-ruling'
              onClick={() => setChanging(true)}
              variant='outline'
              size='sm'
            >
              {intl.formatMessage({ id: 'securityScan.action.changeRuling' })}
            </Button>
          </div>
        )}
        {(!finding.disposition || changing) && (
          <div className='mt-2 flex flex-wrap items-center gap-1.5'>
            {pending === null ? (
              <>
                <Button
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
                  variant='outline'
                  size='sm'
                  className='[&_svg]:size-3'
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
                </Button>
                {finding.disposition !== 'FALSE_POSITIVE' && (
                  <Button
                    type='button'
                    onClick={() => setPending('FALSE_POSITIVE')}
                    variant='outline'
                    size='sm'
                  >
                    {intl.formatMessage({
                      id: 'securityScan.action.falsePositive',
                    })}
                  </Button>
                )}
                {finding.disposition !== 'ACCEPTED_RISK' && (
                  <Button
                    type='button'
                    onClick={() => setPending('ACCEPTED_RISK')}
                    variant='outline'
                    size='sm'
                  >
                    {intl.formatMessage({
                      id: 'securityScan.action.acceptRisk',
                    })}
                  </Button>
                )}
                {finding.disposition && (
                  // LUM-1128 follow-up: revert a mistaken ruling (e.g. a
                  // CLI one) — the finding is open again and, if policy
                  // says so, blocks DONE again. Web only.
                  <Button
                    type='button'
                    data-testid='finding-reopen'
                    onClick={() => setPending('OPEN')}
                    variant='outline'
                    size='sm'
                  >
                    {intl.formatMessage({
                      id: 'securityScan.action.reopen',
                    })}
                  </Button>
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
                  <Input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={intl.formatMessage({
                      id: 'securityScan.action.notePlaceholder',
                    })}
                    aria-label={intl.formatMessage({
                      id: 'securityScan.action.notePlaceholder',
                    })}
                    className='h-control-sm min-w-[12rem] flex-1 text-caption md:text-caption'
                  />
                )}
                <Button
                  type='button'
                  size='sm'
                  disabled={submitting}
                  onClick={submit}
                >
                  {intl.formatMessage({ id: 'securityScan.action.confirm' })}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={submitting}
                  onClick={() => {
                    setPending(null)
                    setChanging(false)
                    setNote('')
                  }}
                >
                  {intl.formatMessage({ id: 'securityScan.action.cancel' })}
                </Button>
              </>
            )}
          </div>
        )}
      </CollapsibleContent>
      {error && (
        <p
          data-testid='finding-disposition-error'
          className='mt-0.5 text-caption text-danger-text'
        >
          {error}
        </p>
      )}
    </CollapsibleCard>
  )
}

/**
 * LUM-1308 — where a finding is: `file:line`, linked to the PR's changed
 * files when the PR is known, else as text. A finding with no file path
 * shows no location.
 */
function FindingLocation({
  finding,
  prUrl,
}: {
  finding: Pick<SecurityFindingView, 'filePath' | 'line'>
  prUrl?: string | undefined
}) {
  const text = `${finding.filePath}${finding.line != null ? `:${finding.line}` : ''}`
  if (!finding.filePath) return null
  if (!prUrl)
    return (
      <span className='min-w-0 truncate font-mono text-caption text-muted-foreground'>
        {text}
      </span>
    )
  return (
    <a
      data-testid='finding-location'
      href={`${prUrl}/files`}
      target='_blank'
      rel='noopener noreferrer'
      className='min-w-0 truncate font-mono text-caption text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground'
    >
      {text}
    </a>
  )
}

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
      <span className={`uppercase ${tone}`}>
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
