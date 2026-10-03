import { USAGE_DEDUPE_CUTOFF } from '@/lib/agent-run/usage-dedupe-cutoff'
import { miscRepository } from '@/lib/repositories/misc.repository'
import type { ModelUsage } from '@/lib/repositories/session.repository'
import {
  usageResyncRepository,
  type ResyncEventRow,
  type ResyncSessionRow,
  type ResyncSessionUsage,
  type SessionResyncWrite,
} from '@/lib/repositories/usage-resync.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'
import { scaleUsageMap, usageScaleFactors } from '@/lib/services/model-cost'
import {
  splitSubagentUsage,
  type InjectedUsage,
} from '@/lib/session/subagent-usage'
import type {
  ResyncSessionInput,
  ResyncTotal,
} from '@/lib/validation/usage-resync'

export type UsageResyncReason =
  | 'not_found'
  | 'active_after_cutoff'
  | 'already_resynced'
  | 'no_usage'
  | 'not_inflated'

export interface UsageResyncResult {
  sessionId: string
  status: 'resynced' | 'would_resync' | 'skipped'
  reason?: UsageResyncReason
  /** Family token totals (all kinds, root + matched children). */
  before?: number
  after?: number
  sessionsCorrected?: number
  rowsScaled?: number
}

export interface UsageResyncResponse {
  dryRun: boolean
  results: UsageResyncResult[]
}

const CUTOFF = new Date(USAGE_DEDUPE_CUTOFF)

const skipped = (
  sessionId: string,
  reason: UsageResyncReason
): UsageResyncResult => ({ sessionId, status: 'skipped', reason })

const flatTotal = (r: {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}) =>
  (r.inputTokens ?? 0) +
  (r.outputTokens ?? 0) +
  (r.cacheReadTokens ?? 0) +
  (r.cacheCreationTokens ?? 0)

const hasUsage = (r: ResyncSessionRow) =>
  r.inputTokens !== null && r.usageByModel !== null

const toInjected = (
  total: ResyncTotal,
  byModel: Record<string, ModelUsage>
): InjectedUsage => ({ ...total, byModel })

const toUsage = (u: InjectedUsage): ResyncSessionUsage => ({
  inputTokens: u.inputTokens,
  outputTokens: u.outputTokens,
  cacheReadTokens: u.cacheReadTokens,
  cacheCreationTokens: u.cacheCreationTokens,
  usageByModel: u.byModel,
})

interface Correction {
  row: ResyncSessionRow
  target: ResyncSessionUsage
}

/**
 * Exact targets per family member. The root keeps `total − Σ subagents` (the
 * same split the hook path applies), subtracting only subagents that HAVE a
 * child row: a subagent without one ran before child sessions existed, so its
 * usage is still inside the root's stored figures and must stay there.
 */
function familyTargets(
  input: ResyncSessionInput,
  root: ResyncSessionRow,
  children: ResyncSessionRow[]
): Correction[] {
  const childById = new Map(children.map(c => [c.id, c]))
  const subs: Record<string, InjectedUsage> = {}
  const out: Correction[] = []
  for (const [agentId, sub] of Object.entries(input.bySubagent ?? {})) {
    const child = childById.get(`${root.id}:${agentId}`)
    if (!child) continue
    const usage = toInjected(sub.total, sub.byModel)
    subs[agentId] = usage
    out.push({ row: child, target: toUsage(usage) })
  }
  const { main } = splitSubagentUsage({
    ...toInjected(input.total, input.byModel),
    bySubagent: subs,
  })
  return [{ row: root, target: toUsage(main) }, ...out]
}

const storedColumns = (r: ResyncSessionRow) => ({
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  cacheReadTokens: r.cacheReadTokens,
  cacheCreationTokens: r.cacheCreationTokens,
  usageByModel: r.usageByModel,
  liveUsageByModel: r.liveUsageByModel,
})

function buildWrite(c: Correction, rows: ResyncEventRow[]): SessionResyncWrite {
  const oldMap = c.row.usageByModel ?? {}
  const factors = usageScaleFactors(oldMap, c.target.usageByModel)
  const own = rows.filter(r => r.sessionId === c.row.id)
  return {
    sessionId: c.row.id,
    usage: c.target,
    rows: own.map(r => ({
      id: r.id,
      usageByModel: scaleUsageMap(r.usageByModel, factors),
    })),
    audit: {
      before: storedColumns(c.row),
      after: { ...c.target, liveUsageByModel: c.target.usageByModel },
      factors,
      rows: Object.fromEntries(own.map(r => [r.id, r.usageByModel])),
    },
  }
}

/**
 * The family root when it was checked but not lowered while a child was:
 * it is flagged so the run-level notice (keyed on the root) clears and a
 * repeat run reports already_resynced. Its audit row is a "verified,
 * unchanged" marker — after equals before, factors all 1, no rows touched —
 * so a revert only clears the flag.
 */
function verifiedRootWrite(root: ResyncSessionRow): SessionResyncWrite {
  const map = root.usageByModel ?? {}
  return {
    sessionId: root.id,
    usage: null,
    rows: [],
    audit: {
      before: storedColumns(root),
      after: storedColumns(root),
      factors: Object.fromEntries(
        Object.keys(map).map(m => [
          m,
          { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 },
        ])
      ),
      rows: {},
    },
  }
}

async function resyncOne(
  input: ResyncSessionInput,
  ctx: {
    workspaceId: string
    memberId: string
    dryRun: boolean
    now: Date
  }
): Promise<UsageResyncResult> {
  const rootId = input.sessionId
  // Only root sessions are resynced; children arrive via `bySubagent`.
  if (rootId.includes(':')) return skipped(rootId, 'not_found')
  const childIds = Object.keys(input.bySubagent ?? {}).map(
    a => `${rootId}:${a}`
  )
  const family = await usageResyncRepository.findFamilyForMember(
    rootId,
    ctx.memberId,
    childIds
  )
  if (!family) return skipped(rootId, 'not_found')
  const { root, children } = family
  if (root.usageResyncedAt) return skipped(rootId, 'already_resynced')
  // A session active since the fix may still be on an old CLI and would
  // re-inflate; its figures are not a clean historical snapshot.
  if ([root, ...children].some(s => s.lastActivityAt >= CUTOFF))
    return skipped(rootId, 'active_after_cutoff')
  if (!hasUsage(root)) return skipped(rootId, 'no_usage')

  const corrections = familyTargets(input, root, children).filter(
    c =>
      hasUsage(c.row) &&
      c.row.usageResyncedAt === null &&
      flatTotal(c.target) < flatTotal(c.row)
  )
  const before = [root, ...children].reduce((s, r) => s + flatTotal(r), 0)
  const after =
    before -
    corrections.reduce((s, c) => s + flatTotal(c.row) - flatTotal(c.target), 0)
  if (corrections.length === 0)
    return { ...skipped(rootId, 'not_inflated'), before, after }

  const rows = await usageResyncRepository.findUsageRows(
    corrections.map(c => c.row.id)
  )
  const writes = corrections.map(c => buildWrite(c, rows))
  const plan = {
    sessionId: rootId,
    before,
    after,
    sessionsCorrected: writes.length,
    rowsScaled: writes.reduce((s, w) => s + w.rows.length, 0),
  }
  if (!corrections.some(c => c.row.id === root.id))
    writes.unshift(verifiedRootWrite(root))
  if (ctx.dryRun) return { ...plan, status: 'would_resync' }
  try {
    await usageResyncRepository.applyFamilyResync({
      workspaceId: ctx.workspaceId,
      workspaceMemberId: ctx.memberId,
      activeBefore: CUTOFF,
      now: ctx.now,
      sessions: writes,
    })
  } catch (error) {
    if ((error as { status?: number } | null)?.status === 409)
      return skipped(rootId, 'already_resynced')
    throw error
  }
  return { ...plan, status: 'resynced' }
}

export const usageResyncService = {
  /**
   * LUM-932 `lumo usage resync`: replace inflated pre-1.85.0 usage of the
   * caller's own inactive sessions with exact deduped transcript figures.
   * Dry run computes the same per-session plan and writes nothing.
   */
  async resync(input: {
    identity: VerifyApiKeyResult
    dryRun: boolean
    sessions: ResyncSessionInput[]
    now?: Date
  }): Promise<UsageResyncResponse> {
    const memberId = await miscRepository.findMemberIdForHook(
      input.identity.user.id,
      input.identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }
    const ctx = {
      workspaceId: input.identity.workspace.id,
      memberId,
      dryRun: input.dryRun,
      now: input.now ?? new Date(),
    }
    const results: UsageResyncResult[] = []
    for (const s of input.sessions) results.push(await resyncOne(s, ctx))
    return { dryRun: input.dryRun, results }
  },
}
