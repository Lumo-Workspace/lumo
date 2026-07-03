'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { MilestoneOutcomeSection } from './MilestoneOutcomeSection'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { ApiMilestone } from '@/lib/api-client/milestones'
import { formatDurationSec } from '@/lib/datetime/duration'
import type { WorkspaceMemberInfo } from '../../types'

type MilestoneBurnupPayload = NonNullable<ApiMilestone['burnup']>

// Mirror the CLI's compact token formatter (notation:'compact',
// maximumFractionDigits:1) so the same number reads identically in both
// surfaces — the LUM-560 convention the task-level cost card already follows.
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}

/**
 * LUM-634 — compact `+adds/−dels` change-volume reading (same compact
 * notation as the token formatter, per the task-level convention), colored
 * the GitHub way: additions green, deletions red (chart-2 / danger — the
 * same hues the member change-volume split bar already uses). Only ever
 * rendered with MEASURED sums — the unsynced state renders text, never +0/−0.
 */
function VolumeText({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  return (
    <span data-testid='change-volume' className='tabular-nums'>
      <span className='text-[var(--chart-2)]'>
        +{TOKEN_FMT.format(additions)}
      </span>
      <span className='font-normal text-muted-foreground'>/</span>
      <span className='text-[var(--danger)]'>
        −{TOKEN_FMT.format(deletions)}
      </span>
    </span>
  )
}

export interface MilestoneBurnupBand {
  sprintId: string
  name: string
  x1: string
  x2: string
}

/**
 * Pure shaping of the milestone burnup payload into Recharts rows, the Y-axis
 * ceiling, and the covering sprints' bands clamped to the series' date domain
 * (a window that lies entirely outside the series is dropped; an ACTIVE
 * sprint's future days are cut at the series end). Kept pure for unit testing
 * without mounting Recharts.
 */
export function buildMilestoneBurnupChart(burnup: MilestoneBurnupPayload): {
  rows: MilestoneBurnupPayload['series']
  maxY: number
  bands: MilestoneBurnupBand[]
} {
  const bands: MilestoneBurnupBand[] = []
  for (const w of burnup.sprintWindows) {
    const x1 = w.start < burnup.start ? burnup.start : w.start
    const x2 = w.end > burnup.end ? burnup.end : w.end
    if (x1 > x2) continue
    bands.push({ sprintId: w.sprintId, name: w.name, x1, x2 })
  }
  return {
    rows: burnup.series,
    maxY: Math.max(burnup.scopeTotal, 1),
    bands,
  }
}

/**
 * 'YYYY-MM-DD' → a short, locale-ordered day label. Parsed by hand into a
 * local-time Date (no UTC string parse) so the rendered day can't slip across
 * a timezone boundary.
 */
function formatDay(date: string, locale?: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    month: 'numeric',
    day: 'numeric',
  })
}

/** Shared card-title treatment for the mission-control cards. */
const KPI_LABEL =
  'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
const CARD = 'rounded-lg border border-border bg-card p-5'

type ModelUsageRow = NonNullable<
  NonNullable<ApiMilestone['costRollup']>['models']
>[number]

// Token-kind segments in bar order — the same chart-1..4 encoding (and the
// muted cache-read) the task-level TokenCostBreakdown uses, so the two
// surfaces read identically. Static literal classes so Tailwind emits them.
const MODEL_SEGMENTS: {
  key: 'output' | 'input' | 'cacheCreation' | 'cacheRead'
  bar: string
  labelId: string
}[] = [
  { key: 'output', bar: 'bg-chart-1', labelId: 'tokenCost.output' },
  { key: 'input', bar: 'bg-chart-2', labelId: 'tokenCost.input' },
  {
    key: 'cacheCreation',
    bar: 'bg-chart-3',
    labelId: 'tokenCost.cacheCreate',
  },
  { key: 'cacheRead', bar: 'bg-chart-4/40', labelId: 'tokenCost.cacheRead' },
]

/** How many per-model rows render before folding into the more-models line. */
const MODEL_ROWS_SHOWN = 3

/**
 * LUM-636 per-model token split: one row per model (top N by total, the rest
 * folded into an explicit more-models line) with a four-kind segment bar.
 * Honest by construction — renders nothing when the payload carries no model
 * data, and spend not attributable to a model states so on its own line
 * (pre-LUM-298 sessions), never folded into a model row.
 */
function ModelUsageBreakdown({
  models,
  unattributedTokens,
  showLegend = false,
}: {
  models: ModelUsageRow[] | undefined
  unattributedTokens?: number | undefined
  showLegend?: boolean
}) {
  const intl = useIntl()
  if (!models || models.length === 0) return null
  const top = models.slice(0, MODEL_ROWS_SHOWN)
  const rest = models.slice(MODEL_ROWS_SHOWN)
  const restTotal = rest.reduce((sum, m) => sum + m.total, 0)
  // Exact (ungrouped-compact) numbers live in the hover tooltip only — the
  // rows keep the compact reading, the tooltip answers "how much exactly".
  const fmtExact = (n: number) => n.toLocaleString(intl.locale)
  return (
    <div className='mt-3 space-y-2'>
      {top.map(m => (
        <div key={m.model} data-testid='model-usage-row'>
          <div className='flex items-baseline justify-between gap-2 text-[11px]'>
            <span className='min-w-0 truncate font-semibold'>{m.model}</span>
            <span className='shrink-0 tabular-nums text-muted-foreground'>
              {fmtTokens(m.total)}
            </span>
          </div>
          {/* Same hover affordance as the task-level TokenCostBreakdown bar:
              the segment bar carries a tooltip with the four exact counts. */}
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Focusable so keyboard users reach the exact counts too. */}
              <div
                data-testid='model-usage-bar'
                tabIndex={0}
                aria-label={m.model}
                className='mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                {MODEL_SEGMENTS.map(seg => {
                  const value = m[seg.key]
                  if (value <= 0 || m.total <= 0) return null
                  return (
                    <span
                      key={seg.key}
                      className={seg.bar}
                      style={{ width: `${(value / m.total) * 100}%` }}
                    />
                  )
                })}
              </div>
            </TooltipTrigger>
            <TooltipContent className='border bg-popover text-popover-foreground'>
              <div className='flex flex-col gap-1'>
                {MODEL_SEGMENTS.map(seg => (
                  <div
                    key={seg.key}
                    className={
                      seg.key === 'cacheRead'
                        ? 'flex items-center justify-between gap-5 text-muted-foreground/70'
                        : 'flex items-center justify-between gap-5'
                    }
                  >
                    <span className='flex items-center gap-1.5'>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${seg.bar}`}
                        aria-hidden='true'
                      />
                      {intl.formatMessage({ id: seg.labelId })}
                    </span>
                    <span className='tabular-nums'>{fmtExact(m[seg.key])}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      ))}
      {rest.length > 0 && (
        <p className='text-[11px] text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.costTrend.moreModels' },
            { count: rest.length, total: fmtTokens(restTotal) }
          )}
        </p>
      )}
      {(unattributedTokens ?? 0) > 0 && (
        <p className='text-[11px] text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.costTrend.modelUnattributed' },
            { total: fmtTokens(unattributedTokens ?? 0) }
          )}
        </p>
      )}
      {showLegend && (
        <div className='flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground'>
          {MODEL_SEGMENTS.map(seg => (
            <span key={seg.key} className='flex items-center gap-1'>
              <span
                className={`h-1.5 w-1.5 rounded-full ${seg.bar}`}
                aria-hidden='true'
              />
              {intl.formatMessage({ id: seg.labelId })}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface MilestoneCostTrendSectionProps {
  costRollup: ApiMilestone['costRollup']
  burnup: ApiMilestone['burnup']
  deliveryStats: ApiMilestone['deliveryStats']
  memberDelivery: ApiMilestone['memberDelivery']
  /** LUM-626 outcome rollup — feeds the delivery-quality counts. */
  outcome?: ApiMilestone['outcome']
  /** Workspace members (client cache) — avatars for the by-member rows. */
  members?: WorkspaceMemberInfo[] | undefined
}

/**
 * LUM-627/632/634 — the Overview tab's cost + trajectory rollup, laid out as
 * the LUM-636 mission-control rows: a 4-card KPI row (tokens / active time /
 * merged PRs / change volume), a burnup + delivery-quality row, and the
 * per-member expandable rows (spend + delivery dual attribution). Aggregates
 * only — never a per-task list. Honest by construction: an unmeasured total
 * states "not measured" instead of implying a clean 0, a no-PR milestone
 * states "no PRs on record", unattributable spend gets an explicit row, and
 * quality reads counts, never ratios.
 */
export function MilestoneCostTrendSection({
  costRollup,
  burnup,
  deliveryStats,
  memberDelivery,
  outcome,
  members,
}: MilestoneCostTrendSectionProps) {
  const intl = useIntl()
  // Older-server tolerance: without any enrich field there is nothing
  // honest to say — render nothing rather than fabricate placeholders.
  if (
    !costRollup &&
    !burnup &&
    !deliveryStats &&
    !memberDelivery &&
    !outcome?.greenQuality
  )
    return null

  return (
    <section
      aria-label={intl.formatMessage({ id: 'milestone.costTrend.label' })}
      className='mb-10 space-y-4'
    >
      {(costRollup || deliveryStats) && (
        <KpiCardRow costRollup={costRollup} deliveryStats={deliveryStats} />
      )}

      {(burnup || deliveryStats || memberDelivery) && (
        <div className='grid gap-4 lg:grid-cols-[2fr_1fr]'>
          {burnup && <BurnupCard burnup={burnup} />}
          {(deliveryStats || memberDelivery || outcome) && (
            <DeliveryQualityCard
              deliveryStats={deliveryStats}
              memberDelivery={memberDelivery}
              outcome={outcome ?? null}
            />
          )}
        </div>
      )}

      {(deliveryStats || memberDelivery) && (
        <PerMemberTable
          perMember={deliveryStats?.perMember}
          memberDelivery={memberDelivery ?? undefined}
          members={members}
        />
      )}

      {/* LUM-639 acceptance-quality audit footnote — closes the outcome zone. */}
      <MilestoneOutcomeSection greenQuality={outcome?.greenQuality} />
    </section>
  )
}

/** The 4-card KPI row: tokens · active time · merged PRs · change volume. */
function KpiCardRow({
  costRollup,
  deliveryStats,
}: {
  costRollup: ApiMilestone['costRollup']
  deliveryStats: ApiMilestone['deliveryStats']
}) {
  const intl = useIntl()
  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      {costRollup && (
        <>
          <div className={CARD}>
            <p className={KPI_LABEL}>
              {intl.formatMessage({ id: 'milestone.costTrend.tokens' })}
            </p>
            <p className='mt-2 text-2xl font-bold tracking-tight tabular-nums'>
              {costRollup.tokenCost === null ? (
                <span className='font-normal text-muted-foreground'>
                  {intl.formatMessage({
                    id: 'milestone.costTrend.notMeasured',
                  })}
                </span>
              ) : (
                fmtTokens(costRollup.tokenCost)
              )}
            </p>
            <ModelUsageBreakdown
              models={costRollup.models}
              unattributedTokens={costRollup.modelUnattributedTokens}
              showLegend
            />
            <p className='mt-1 text-xs text-muted-foreground'>
              {intl.formatMessage(
                { id: 'milestone.costTrend.coverage' },
                {
                  measured: costRollup.measuredTasks,
                  total: costRollup.totalTasks,
                }
              )}
            </p>
          </div>
          <div className={CARD}>
            <p className={KPI_LABEL}>
              {intl.formatMessage({ id: 'milestone.costTrend.activeTime' })}
            </p>
            <p className='mt-2 text-2xl font-bold tracking-tight tabular-nums'>
              {formatDurationSec(intl, costRollup.activeTimeSec)}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.costTrend.activeTimeNote' })}
            </p>
          </div>
        </>
      )}
      {deliveryStats && (
        <>
          <div className={CARD}>
            <p className={KPI_LABEL}>
              {intl.formatMessage({ id: 'milestone.deliveryStats.mergedPrs' })}
            </p>
            <p className='mt-2 text-2xl font-bold tracking-tight tabular-nums'>
              {deliveryStats.pr.linkedTaskCount === 0 ? (
                <span className='font-normal text-muted-foreground'>
                  {intl.formatMessage({
                    id: 'milestone.deliveryStats.noPrRecords',
                  })}
                </span>
              ) : (
                deliveryStats.pr.mergedPrCount
              )}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {intl.formatMessage(
                { id: 'milestone.deliveryStats.reworkDetail' },
                {
                  multiPr: deliveryStats.pr.multiPrTaskCount,
                  unlinked: deliveryStats.pr.unlinkedTaskCount,
                }
              )}
            </p>
          </div>
          {/* Older-server payloads without changeVolume render 3 KPI cards —
              the change surface stays honest on the quality card instead of
              being duplicated here. */}
          {deliveryStats.changeVolume && (
            <div className={CARD}>
              <p className={KPI_LABEL}>
                {intl.formatMessage({ id: 'milestone.changeVolume.title' })}
              </p>
              <p className='mt-2 text-2xl font-bold tracking-tight tabular-nums'>
                {deliveryStats.changeVolume.totalMergedPrs === 0 ? (
                  <span className='font-normal text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'milestone.deliveryStats.noPrRecords',
                    })}
                  </span>
                ) : deliveryStats.changeVolume.additions === null ||
                  deliveryStats.changeVolume.deletions === null ? (
                  // Unsynced ≠ 0: zero measured PRs reads as an explicit
                  // not-synced state, never a fabricated +0/−0.
                  <span className='font-normal text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'milestone.changeVolume.notSynced',
                    })}
                  </span>
                ) : (
                  <VolumeText
                    additions={deliveryStats.changeVolume.additions}
                    deletions={deliveryStats.changeVolume.deletions}
                  />
                )}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'milestone.changeVolume.coverage' },
                  {
                    measured: deliveryStats.changeVolume.measuredPrs,
                    total: deliveryStats.changeVolume.totalMergedPrs,
                  }
                )}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.changeVolume.note' })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Delivery quality — the 2×2 counts grid (rejected after delivery, FAIL
 * rounds / send-backs, multi-PR tasks, change surface). Counts, never ratios;
 * a zero reads as "no rejection on record", not a pass, and the change
 * surface fail-closes to "not measured".
 */
function DeliveryQualityCard({
  deliveryStats,
  memberDelivery,
  outcome,
}: {
  deliveryStats: ApiMilestone['deliveryStats']
  memberDelivery: ApiMilestone['memberDelivery']
  outcome: ApiMilestone['outcome']
}) {
  const intl = useIntl()
  const dash = <span className='text-muted-foreground'>—</span>

  const friction = memberDelivery
    ? memberDelivery.rows.reduce(
        (acc, r) => ({
          failRounds: acc.failRounds + r.friction.failRoundCount,
          sendBacks: acc.sendBacks + r.friction.sendBackCount,
        }),
        { failRounds: 0, sendBacks: 0 }
      )
    : null

  const stat = (
    value: React.ReactNode,
    labelId: string,
    detail?: React.ReactNode
  ) => (
    <div>
      <p className='text-xl font-bold tracking-tight tabular-nums'>{value}</p>
      <p className='mt-0.5 text-xs text-muted-foreground'>
        {intl.formatMessage({ id: labelId })}
      </p>
      {detail}
    </div>
  )

  return (
    <div className={CARD}>
      <h3 className='mb-4 text-sm font-semibold text-foreground'>
        {intl.formatMessage({ id: 'milestone.quality.title' })}
      </h3>
      <div className='grid grid-cols-2 gap-4'>
        {stat(
          outcome ? outcome.fate.rejected.length : dash,
          'milestone.quality.rejected'
        )}
        {stat(
          friction
            ? intl.formatMessage(
                { id: 'milestone.quality.frictionValue' },
                {
                  failRounds: friction.failRounds,
                  sendBacks: friction.sendBacks,
                }
              )
            : dash,
          'milestone.quality.friction'
        )}
        {stat(
          deliveryStats ? deliveryStats.pr.multiPrTaskCount : dash,
          'milestone.quality.multiPr'
        )}
        {stat(
          deliveryStats ? (
            deliveryStats.changedFiles.total === null ? (
              <span className='font-normal text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.costTrend.notMeasured' })}
              </span>
            ) : (
              deliveryStats.changedFiles.total
            )
          ) : (
            dash
          ),
          'milestone.quality.changeSurface',
          deliveryStats ? (
            <p className='mt-0.5 text-xs text-muted-foreground'>
              {intl.formatMessage(
                { id: 'milestone.costTrend.coverage' },
                {
                  measured: deliveryStats.changedFiles.measuredTasks,
                  total: deliveryStats.changedFiles.totalTasks,
                }
              )}
            </p>
          ) : undefined
        )}
      </div>
      <p className='mt-4 text-[11px] leading-normal text-muted-foreground'>
        {intl.formatMessage({ id: 'milestone.quality.countsNote' })}
      </p>
    </div>
  )
}

type SpendPerMember = NonNullable<ApiMilestone['deliveryStats']>['perMember']
type MemberDeliveryPayload = NonNullable<ApiMilestone['memberDelivery']>
type MemberDeliveryRow = MemberDeliveryPayload['rows'][number]

/** One rendered member-table row: the two attribution 口径 side by side —
 * spend (session spender, LUM-632, incl. the LUM-634 merged-PR change
 * volume that rides the same attribution) and delivery (task assignee,
 * LUM-633). Either half may be absent; the cells then read '—' rather than
 * a fabricated 0. */
export interface MergedMemberRow {
  key: string
  bucket: MemberDeliveryRow['bucket']
  label: string | null
  spend: {
    tokenCost: number
    activeTimeSec: number
    /** LUM-634 measured merged-PR volume; `null` = nothing synced
     * attributes here — renders the explicit no-synced state, never +0/−0. */
    changeVolume: {
      additions: number
      deletions: number
      measuredPrs: number
    } | null
    /** LUM-636 per-model split of this member's measured spend; empty when
     * no session carries a usageByModel map — no bars, never fabricated. */
    models: ModelUsageRow[]
    /** Flat-only remainder (pre-LUM-298 sessions), stated explicitly. */
    modelUnattributedTokens: number
  } | null
  delivery: MemberDeliveryRow | null
}

/**
 * Merge the spend rows and the delivery rows into one per-member table model.
 * Member rows are FIXED name-sorted (never by volume — no leaderboard);
 * the explicit unassigned and unattributed buckets always render last, with
 * the spend-side member-less remainder folded onto the unattributed row.
 * Pure — exported for unit testing without mounting the table.
 */
export function buildMemberDeliveryRows(
  perMember: SpendPerMember | undefined,
  memberDelivery: MemberDeliveryPayload
): MergedMemberRow[] {
  const spendByMember = new Map<string | null, SpendPerMember['rows'][number]>(
    (perMember?.rows ?? []).map(r => [r.memberId, r])
  )
  const toSpend = (memberId: string | null) => {
    const row = spendByMember.get(memberId)
    return row
      ? {
          tokenCost: row.tokenCost,
          activeTimeSec: row.activeTimeSec,
          changeVolume: row.changeVolume ?? null,
          models: row.models ?? [],
          modelUnattributedTokens: row.modelUnattributedTokens ?? 0,
        }
      : null
  }

  const memberRows: MergedMemberRow[] = []
  const tailRows: MergedMemberRow[] = []
  const seenMembers = new Set<string>()
  let unattributedDelivery: MemberDeliveryRow | null = null
  for (const row of memberDelivery.rows) {
    if (row.bucket === 'member' && row.memberId !== null) {
      seenMembers.add(row.memberId)
      memberRows.push({
        key: row.memberId,
        bucket: 'member',
        label: row.label,
        spend: toSpend(row.memberId),
        delivery: row,
      })
    } else if (row.bucket === 'unassigned') {
      tailRows.push({
        key: '__unassigned__',
        bucket: 'unassigned',
        label: null,
        spend: null,
        delivery: row,
      })
    } else {
      unattributedDelivery = row
    }
  }
  // Members who only spent (no task attributed to them) still get a row.
  for (const row of perMember?.rows ?? []) {
    if (row.memberId === null || seenMembers.has(row.memberId)) continue
    memberRows.push({
      key: row.memberId,
      bucket: 'member',
      label: row.label,
      spend: toSpend(row.memberId),
      delivery: null,
    })
  }
  memberRows.sort(
    (a, b) =>
      (a.label ?? '').localeCompare(b.label ?? '') || a.key.localeCompare(b.key)
  )
  // One explicit unattributed row carries both leftovers: the delivery
  // bucket (unresolvable agent deliveries) and the spend remainder
  // (member-less sessions).
  const unattributedSpend = toSpend(null)
  if (unattributedDelivery || unattributedSpend) {
    tailRows.push({
      key: '__unattributed__',
      bucket: 'unattributed',
      label: null,
      spend: unattributedSpend,
      delivery: unattributedDelivery,
    })
  }
  return [...memberRows, ...tailRows]
}

/**
 * The per-member block. With only the LUM-632 spend payload it renders the
 * spend table; with the LUM-633 delivery payload it renders the LUM-636
 * expandable member rows — both 口径 in one row. Fail-closed: an unmeasured
 * spend side reads '—' / "not measured", never a fabricated 0.
 */
function PerMemberTable({
  perMember,
  memberDelivery,
  members,
}: {
  perMember: SpendPerMember | undefined
  memberDelivery: MemberDeliveryPayload | undefined
  members: WorkspaceMemberInfo[] | undefined
}) {
  if (!memberDelivery) {
    if (!perMember) return null
    return <SpendOnlyMemberTable perMember={perMember} />
  }
  return (
    <MemberDeliveryRows
      perMember={perMember}
      memberDelivery={memberDelivery}
      members={members}
    />
  )
}

const CLAIM_SOURCES = new Set(['AGENT', 'RUN_SUMMARY', 'DIGEST'])

/** Initials for the member avatar circle — first letters of up to two words. */
function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * LUM-636 by-member rows: one expandable row per member (fixed name order,
 * never a leaderboard), the explicit unassigned / unattributed buckets last.
 * Collapsed: avatar, label, spend/delivery summary, share of milestone
 * tokens. Expanded: change-volume split, delivered / merged-PR unit marks,
 * quality chips, and the frozen delivery claims (same source and labels as
 * the task evidence). Quantity stays inseparable from quality — counts only.
 */
function MemberDeliveryRows({
  perMember,
  memberDelivery,
  members,
}: {
  perMember: SpendPerMember | undefined
  memberDelivery: MemberDeliveryPayload
  members: WorkspaceMemberInfo[] | undefined
}) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const rows = buildMemberDeliveryRows(perMember, memberDelivery)
  // memberId → workspace avatar (client members cache); rows without a
  // match simply fall back to initials — never a broken image.
  const imageByMember = new Map(
    (members ?? []).map(m => [m.id, m.imageUrl] as const)
  )
  // Spend cells are only honest when the spend side measured something.
  const spendMeasured = (perMember?.measuredTasks ?? 0) > 0
  const totalTokens = spendMeasured ? (perMember?.tokenCost ?? null) : null

  const bucketLabel = (row: MergedMemberRow) =>
    row.bucket === 'unassigned'
      ? intl.formatMessage({ id: 'milestone.memberDelivery.unassigned' })
      : row.bucket === 'unattributed'
        ? intl.formatMessage({ id: 'milestone.memberDelivery.unattributed' })
        : (row.label ?? row.key)

  return (
    <div className={CARD}>
      <div className='mb-1 flex flex-wrap items-baseline justify-between gap-2'>
        <h3 className='text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'milestone.memberDelivery.tableTitle' })}
        </h3>
        {totalTokens !== null && (
          <span className='text-[11px] text-muted-foreground'>
            {intl.formatMessage(
              { id: 'milestone.memberDelivery.shareHeader' },
              { total: fmtTokens(totalTokens) }
            )}
          </span>
        )}
      </div>
      {/* Both attribution 口径, stated where the numbers are read. */}
      <p className='mb-4 text-xs text-muted-foreground'>
        {intl.formatMessage({ id: 'milestone.memberDelivery.attributionNote' })}
      </p>
      {rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.memberDelivery.empty' })}
        </p>
      ) : (
        <ul className='space-y-1'>
          {rows.map(row => (
            <MemberRow
              key={row.key}
              row={row}
              label={bucketLabel(row)}
              imageUrl={imageByMember.get(row.key) ?? null}
              spendMeasured={spendMeasured}
              totalTokens={totalTokens}
              isExpanded={expanded[row.key] === true}
              onToggle={() =>
                setExpanded(prev => ({
                  ...prev,
                  [row.key]: !(prev[row.key] === true),
                }))
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function MemberRow({
  row,
  label,
  imageUrl,
  spendMeasured,
  totalTokens,
  isExpanded,
  onToggle,
}: {
  row: MergedMemberRow
  label: string
  /** Workspace avatar for member rows (client members cache); buckets none. */
  imageUrl: string | null
  spendMeasured: boolean
  totalTokens: number | null
  isExpanded: boolean
  onToggle: () => void
}) {
  const intl = useIntl()
  const d = row.delivery
  const spend = spendMeasured ? row.spend : null
  const sharePct =
    spend && totalTokens !== null && totalTokens > 0
      ? Math.round((spend.tokenCost / totalTokens) * 100)
      : null

  const summaryParts: string[] = []
  if (spend) {
    summaryParts.push(fmtTokens(spend.tokenCost))
    summaryParts.push(formatDurationSec(intl, spend.activeTimeSec))
  }
  if (d) {
    summaryParts.push(
      intl.formatMessage(
        { id: 'milestone.memberDelivery.doneCount' },
        { count: d.doneCount }
      )
    )
    summaryParts.push(
      intl.formatMessage(
        { id: 'milestone.memberDelivery.prCount' },
        { count: d.mergedPrCount }
      )
    )
  }

  return (
    <li>
      <button
        type='button'
        aria-expanded={isExpanded}
        aria-label={intl.formatMessage(
          { id: 'milestone.memberDelivery.expandClaims' },
          { member: label }
        )}
        onClick={onToggle}
        className='flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left hover:bg-muted/50'
      >
        <span
          aria-hidden='true'
          className='w-2 shrink-0 text-[10px] text-muted-foreground'
        >
          {isExpanded ? '▾' : '▸'}
        </span>
        {row.bucket === 'member' ? (
          // Real workspace avatar; initials only as the loading/no-image
          // fallback (never the primary rendering).
          <Avatar aria-hidden='true' className='h-8 w-8 shrink-0'>
            {imageUrl && <AvatarImage src={imageUrl} alt='' />}
            <AvatarFallback className='text-xs font-semibold'>
              {initials(label)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span
            aria-hidden='true'
            className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold'
          >
            ?
          </span>
        )}
        <span className='min-w-0 flex-1'>
          <span
            className={
              row.bucket === 'member'
                ? 'block truncate text-sm font-semibold'
                : 'block truncate text-sm font-semibold text-muted-foreground'
            }
          >
            {label}
          </span>
          <span className='block truncate text-xs tabular-nums text-muted-foreground'>
            {summaryParts.length > 0 ? summaryParts.join(' · ') : '—'}
          </span>
        </span>
        <span className='shrink-0 text-xs font-semibold tabular-nums'>
          {sharePct !== null ? `${sharePct}%` : '—'}
        </span>
      </button>

      {/* Share track: the one bar allowed on the collapsed row. */}
      {sharePct !== null && (
        <div
          aria-hidden='true'
          className='mb-1 ml-[52px] flex h-1 overflow-hidden rounded-full bg-muted'
        >
          <span
            className='bg-[var(--chart-1)]'
            style={{ width: `${sharePct}%` }}
          />
        </div>
      )}

      {isExpanded && (
        <div className='mb-2 ml-[52px] space-y-3 py-1'>
          {/* Per-model split of this member's spend (LUM-636). */}
          {spend && spend.models.length > 0 && (
            <div>
              <span className='text-[11px] text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.costTrend.tokens' })}
              </span>
              <ModelUsageBreakdown
                models={spend.models}
                unattributedTokens={spend.modelUnattributedTokens}
              />
            </div>
          )}

          {/* Change volume attributed to this spender (LUM-634). */}
          <div>
            <div className='flex items-baseline justify-between text-[11px]'>
              <span className='text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.changeVolume.column' })}
              </span>
              <span className='font-semibold tabular-nums'>
                {spend?.changeVolume ? (
                  <VolumeText
                    additions={spend.changeVolume.additions}
                    deletions={spend.changeVolume.deletions}
                  />
                ) : (
                  // No measured merged PR attributes here — an explicit
                  // state, never a fabricated +0/−0.
                  <span className='font-normal text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'milestone.changeVolume.memberNone',
                    })}
                  </span>
                )}
              </span>
            </div>
            {spend?.changeVolume &&
              spend.changeVolume.additions + spend.changeVolume.deletions >
                0 && (
                <div
                  aria-hidden='true'
                  className='mt-1 flex h-1.5 gap-px overflow-hidden rounded-full'
                >
                  <span
                    className='bg-[var(--chart-2)]'
                    style={{ flexGrow: spend.changeVolume.additions || 0 }}
                  />
                  <span
                    className='bg-[var(--danger)]'
                    style={{ flexGrow: spend.changeVolume.deletions || 0 }}
                  />
                </div>
              )}
          </div>

          {d && (
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <div className='flex items-baseline justify-between text-[11px]'>
                  <span className='text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'milestone.memberDelivery.done',
                    })}
                  </span>
                  <span className='font-semibold tabular-nums'>
                    {d.doneCount}/{d.taskCount}
                  </span>
                </div>
                {d.taskCount > 0 && (
                  <div aria-hidden='true' className='mt-1 flex gap-0.5'>
                    {Array.from({ length: d.taskCount }, (_, i) => (
                      <span
                        key={i}
                        className={
                          i < d.doneCount
                            ? 'h-2 flex-1 rounded-sm bg-[var(--chart-1)]'
                            : 'h-2 flex-1 rounded-sm border border-dashed border-border bg-muted'
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className='flex items-baseline justify-between text-[11px]'>
                  <span className='text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'milestone.memberDelivery.mergedPrs',
                    })}
                  </span>
                  <span className='font-semibold tabular-nums'>
                    {d.mergedPrCount}
                  </span>
                </div>
                {d.mergedPrCount > 0 && (
                  <div aria-hidden='true' className='mt-1 flex gap-0.5'>
                    {Array.from({ length: d.mergedPrCount }, (_, i) => (
                      <span
                        key={i}
                        className='h-2 flex-1 rounded-sm bg-[var(--chart-2)]'
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {d && (
            <div className='flex flex-wrap gap-1.5 text-[11px]'>
              <span className='rounded-full border border-[var(--success-border)] bg-[var(--success-subtle)] px-2 py-0.5 font-medium'>
                {intl.formatMessage(
                  { id: 'milestone.memberDelivery.fateCell' },
                  {
                    rejected: d.fate.rejectedTaskCount,
                    noRecord: d.fate.noRecordDoneCount,
                  }
                )}
              </span>
              <span className='rounded-full border border-border bg-muted px-2 py-0.5 font-medium'>
                {intl.formatMessage(
                  { id: 'milestone.memberDelivery.frictionCell' },
                  {
                    failRounds: d.friction.failRoundCount,
                    sendBacks: d.friction.sendBackCount,
                    multiPr: d.friction.multiPrTaskCount,
                  }
                )}
              </span>
              <span className='rounded-full border border-border bg-muted px-2 py-0.5 font-medium'>
                {d.changedFiles.total === null
                  ? intl.formatMessage({
                      id: 'milestone.costTrend.notMeasured',
                    })
                  : intl.formatMessage(
                      { id: 'milestone.memberDelivery.changedFilesChip' },
                      { count: d.changedFiles.total }
                    )}
              </span>
            </div>
          )}

          {d && d.claims.length > 0 && (
            <ul className='space-y-1.5'>
              {d.claims.map(c => (
                <li
                  key={c.taskId}
                  className='flex items-baseline gap-2 text-sm'
                >
                  <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                    {c.ref}
                  </span>
                  {c.claim ? (
                    <span className='min-w-0 text-foreground'>
                      {c.claim}
                      {c.source && CLAIM_SOURCES.has(c.source) && (
                        <span className='ml-1.5 text-xs text-muted-foreground'>
                          {intl.formatMessage({
                            id: `milestone.outcome.claims.source.${c.source}`,
                          })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span
                      className='min-w-0 italic text-muted-foreground'
                      title={c.title}
                    >
                      {intl.formatMessage({
                        id: 'milestone.outcome.claims.noClaim',
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Per-member spend — the LUM-632 rendering, kept for older-server payloads
 * without the delivery rollup. Fail-closed: zero measured tasks renders
 * "not measured" for the whole table instead of a column of fabricated
 * zeros; a member-less remainder renders as an explicit unattributed row.
 */
function SpendOnlyMemberTable({ perMember }: { perMember: SpendPerMember }) {
  const intl = useIntl()
  return (
    <div className={CARD}>
      <h3 className='mb-3 text-sm font-semibold text-foreground'>
        {intl.formatMessage({ id: 'milestone.deliveryStats.perMemberTitle' })}
      </h3>
      {perMember.rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.deliveryStats.noSessions' })}
        </p>
      ) : perMember.tokenCost === null && perMember.measuredTasks === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.costTrend.notMeasured' })}
        </p>
      ) : (
        <table className='w-full max-w-md text-sm'>
          <thead>
            <tr className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
              <th className='pb-1.5 text-left font-semibold'>
                {intl.formatMessage({ id: 'milestone.deliveryStats.member' })}
              </th>
              <th className='pb-1.5 text-right font-semibold'>
                {intl.formatMessage({ id: 'milestone.costTrend.tokens' })}
              </th>
              <th className='pb-1.5 text-right font-semibold'>
                {intl.formatMessage({ id: 'milestone.costTrend.activeTime' })}
              </th>
              <th className='pb-1.5 text-right font-semibold'>
                {intl.formatMessage({ id: 'milestone.changeVolume.column' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {perMember.rows.map(row => (
              <tr
                key={row.memberId ?? '__unattributed__'}
                className='border-t border-border/60'
              >
                <td
                  className={
                    row.memberId === null
                      ? 'py-1.5 text-muted-foreground'
                      : 'py-1.5'
                  }
                >
                  {row.memberId === null
                    ? intl.formatMessage({
                        id: 'milestone.deliveryStats.unattributed',
                      })
                    : row.label}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {fmtTokens(row.tokenCost)}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatDurationSec(intl, row.activeTimeSec)}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {row.changeVolume ? (
                    <VolumeText
                      additions={row.changeVolume.additions}
                      deletions={row.changeVolume.deletions}
                    />
                  ) : (
                    // No measured merged PR attributes to this member —
                    // an explicit state, never a fabricated +0/−0.
                    <span className='text-muted-foreground'>
                      {intl.formatMessage({
                        id: 'milestone.changeVolume.memberNone',
                      })}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function BurnupCard({ burnup }: { burnup: MilestoneBurnupPayload }) {
  const intl = useIntl()
  const scopeLabel = intl.formatMessage({ id: 'milestone.costTrend.scope' })
  const completedLabel = intl.formatMessage({
    id: 'milestone.costTrend.completed',
  })

  if (burnup.series.length === 0 || burnup.scopeTotal === 0) {
    return (
      <div className={CARD}>
        <h3 className='mb-2 text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'milestone.costTrend.burnupTitle' })}
        </h3>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.costTrend.empty' })}
        </p>
      </div>
    )
  }

  const { rows, maxY, bands } = buildMilestoneBurnupChart(burnup)

  const config = {
    completed: { label: completedLabel, color: 'var(--chart-1)' },
    scope: { label: scopeLabel, color: 'var(--muted-foreground)' },
  } satisfies ChartConfig

  return (
    <div className={CARD}>
      <div className='mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5'>
        <h3 className='text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'milestone.costTrend.burnupTitle' })}
        </h3>
        <span className='text-xs tabular-nums text-muted-foreground'>
          {formatDay(burnup.start, intl.locale)} –{' '}
          {formatDay(burnup.end, intl.locale)}
        </span>
      </div>
      <ChartContainer config={config} className='aspect-[2/1] w-full'>
        <ComposedChart
          data={rows}
          margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient
              id='milestone-burnup-fill'
              x1='0'
              y1='0'
              x2='0'
              y2='1'
            >
              <stop
                offset='5%'
                stopColor='var(--color-completed)'
                stopOpacity={0.35}
              />
              <stop
                offset='95%'
                stopColor='var(--color-completed)'
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          {bands.map((b, i) => (
            <ReferenceArea
              key={b.sprintId}
              x1={b.x1}
              x2={b.x2}
              fill='var(--muted-foreground)'
              fillOpacity={i % 2 === 0 ? 0.06 : 0.12}
              stroke='none'
              label={{
                value: b.name,
                position: 'insideTopLeft',
                fill: 'var(--muted-foreground)',
                fontSize: 10,
              }}
            />
          ))}
          <XAxis
            dataKey='date'
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={value => formatDay(String(value), intl.locale)}
          />
          <YAxis
            width={28}
            domain={[0, maxY]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tickCount={3}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={value => formatDay(String(value), intl.locale)}
              />
            }
          />
          <Area
            dataKey='completed'
            type='monotone'
            stroke='var(--color-completed)'
            strokeWidth={2}
            fill='url(#milestone-burnup-fill)'
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
          <Line
            dataKey='scope'
            type='monotone'
            stroke='var(--color-scope)'
            strokeWidth={1.5}
            strokeOpacity={0.55}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
        </ComposedChart>
      </ChartContainer>
      <div className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-muted-foreground' />
          {scopeLabel}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-chart-1' />
          {completedLabel}
        </span>
      </div>
    </div>
  )
}
