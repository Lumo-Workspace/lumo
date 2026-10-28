import { prisma } from '@/lib/db/prisma'
import type { Prisma, SessionRole, TaskArtifactAgent } from '@prisma/client'
import { buildChildSessionId } from '@/lib/session/child-session-id'
import { stripCodeFromStoredFields } from '@/lib/ai-derived/strip-code'
import { redactStoredFields } from '@/lib/security-scan/storage-redaction'
import {
  bumpFamilyAttributionVersion,
  clearProvisionalTagsForSteward,
  retagEventsToExplicitTask,
} from '@/lib/repositories/explicit-retag'
import { RETAG_TX_OPTIONS } from '@/lib/repositories/open-crossing-move'
import { inferredTopLevelSessionsForTask } from '@/lib/repositories/task-attribution-where'
import type { InjectedUsage } from '@/lib/session/subagent-usage'
import type {
  AttributionConfidenceName,
  AttributionSourceName,
} from '@/lib/attribution/run-attribution'
import { addUsageMaps, usageMapTotal } from '@/lib/services/model-cost'

/**
 * LUM-917 — session summaries and run summaries are AI-derived content: code
 * is stripped and credentials redacted before they are stored.
 */
function storedDerivedFields<T extends object>(
  data: T,
  fields: readonly string[]
): T {
  return redactStoredFields(stripCodeFromStoredFields(data, fields), fields)
}

export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/**
 * Per-turn per-model delta = next cumulative minus prior cumulative, clamped
 * to >= 0 per field (a transcript can shrink on compaction, which would make a
 * naive subtraction negative). Models present only in `next` yield their full
 * value (first turn using that model). Pure + exported for unit testing.
 *
 * Usage-drop semantics (LUM-932): CLIs >= 1.85.0 count each transcript
 * assistant message once (older ones summed every JSONL line, ~2x inflated).
 * The first deduped report for a session that an older CLI already reported
 * therefore lands BELOW the stored cumulative. That drop RE-BASELINES: the
 * per-turn/per-step delta clamps to 0 (no negative rows, so budgets, forecast
 * and trajectory sums stay monotonic) and the stored cumulative is replaced by
 * the new lower value, so later growth is measured from the corrected base.
 * The one turn straddling the upgrade records no delta (its real burn is
 * absorbed by the drop). Old CLIs report growing totals except when a
 * transcript shrinks (compaction, or a subagent file removed by retention
 * cleanup); those rare drops now re-baseline the same way. A STOP delivered
 * after the next turn's batch (only on a client hook timeout) resets the live
 * snapshot to its stale value, so that next step can be over-counted once.
 */
export function diffUsageByModel(
  prior: Record<string, ModelUsage> | null | undefined,
  next: Record<string, ModelUsage>
): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {}
  for (const [model, n] of Object.entries(next)) {
    const p = prior?.[model]
    out[model] = {
      input: Math.max(0, n.input - (p?.input ?? 0)),
      output: Math.max(0, n.output - (p?.output ?? 0)),
      cacheRead: Math.max(0, n.cacheRead - (p?.cacheRead ?? 0)),
      cacheCreation: Math.max(0, n.cacheCreation - (p?.cacheCreation ?? 0)),
    }
  }
  return out
}

/** Total tokens across all models/kinds in a cumulative snapshot. */
function snapshotTotal(
  s: Record<string, ModelUsage> | null | undefined
): number {
  if (!s) return -1
  let t = 0
  for (const u of Object.values(s)) {
    t += u.input + u.output + u.cacheRead + u.cacheCreation
  }
  return t
}

/**
 * The more recent of two cumulative snapshots (the one with the larger total).
 * Cumulative token maps grow monotonically within a session, so "larger total"
 * = "later snapshot". Used as the baseline for a POST_TOOL_BATCH per-step delta:
 * the previous snapshot is either the last batch (liveUsageByModel) or the last
 * STOP (usageByModel), whichever is more recent. Null-safe.
 */
export function pickLatestCumulative(
  a: Record<string, ModelUsage> | null | undefined,
  b: Record<string, ModelUsage> | null | undefined
): Record<string, ModelUsage> | null {
  const ta = snapshotTotal(a)
  const tb = snapshotTotal(b)
  if (ta < 0 && tb < 0) return null
  return ta >= tb
    ? (a as Record<string, ModelUsage>)
    : (b as Record<string, ModelUsage>)
}

interface UpsertSessionData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  cwd: string | null
  /**
   * Coding agent that owns the session. Set once on create; never overwritten
   * on update (the agent is fixed for a session's lifetime). Omitted when the
   * hook carried no `X-Lumo-Agent` header, so the DB default (CLAUDE_CODE)
   * applies — accurate today, since only Claude Code emits hooks.
   */
  agent?: TaskArtifactAgent
  now: Date
  /**
   * LUM-1136: the CLI version this hook request carried. Written on every
   * event (not only SessionStart) so a session that outlives a `lumo update`
   * reports the CLI it runs now. Omitted when absent — never clears a value.
   */
  cliVersion?: string
  /**
   * Cumulative session token totals from the CLI transcript. Carried by STOP
   * (full settlement) and POST_TOOL_BATCH (mid-turn, flat columns only).
   */
  usage?:
    | {
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheCreationTokens: number
        /** Cumulative per-model map keyed by raw model string. */
        byModel: Record<string, ModelUsage>
      }
    | null
    | undefined
  /** True when this event is a STOP/STOP_FAILURE -> bump loopCount. */
  isStop?: boolean | undefined
}

interface UpsertWithTaskIdData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  taskId: string
  now: Date
  /** LUM-932: set when `id` is a child session (`<parent>:<agentId>`). */
  parentSessionId?: string
  agentId?: string
  /**
   * LUM-1051: coding agent of a row this attach creates (a Codex session can
   * be attached before any hook reached the server). Never changes an
   * existing row — the first hook event already recorded it.
   */
  agent?: TaskArtifactAgent
}

interface UpsertWithMilestoneIdData {
  id: string
  workspaceId: string
  workspaceMemberId: string
  milestoneId: string
  now: Date
}

/** Ensure the parent row exists (FK target) without counting an event on it. */
async function ensureParentRow(
  tx: Prisma.TransactionClient,
  data: {
    parentSessionId: string
    workspaceId: string
    workspaceMemberId: string
    now: Date
    agent?: TaskArtifactAgent
  }
): Promise<{
  id: string
  taskId: string | null
  role: SessionRole
  milestoneId: string | null
}> {
  // Single upsert (not find-then-create) so two concurrent subagent events for
  // a brand-new parent cannot race into a P2002 that aborts the transaction.
  return tx.session.upsert({
    where: { id: data.parentSessionId },
    create: {
      id: data.parentSessionId,
      workspaceId: data.workspaceId,
      workspaceMemberId: data.workspaceMemberId,
      startedAt: data.now,
      lastActivityAt: data.now,
      eventCount: 0,
      ...(data.agent ? { agent: data.agent } : {}),
    },
    update: {},
    select: { id: true, taskId: true, role: true, milestoneId: true },
  })
}

/**
 * LUM-640: a milestone-bound STEWARD session. Its events (and its subagents')
 * must stay task-less so the post-tool-use steward detector backstop runs.
 */
function isStewardBinding(row: {
  role: SessionRole
  milestoneId: string | null
}): boolean {
  return row.role === 'STEWARD' && row.milestoneId !== null
}

/** Projection the task agent-run timeline reads per session (cost + header). */
const TIMELINE_SESSION_SELECT = {
  id: true,
  agent: true,
  workspaceMemberId: true,
  // clerkId feeds the per-person token rollup (LUM-307); resolved to a
  // display name + avatar in the service via enrichUsers.
  member: { select: { clerkId: true } },
  startedAt: true,
  lastActivityAt: true,
  eventCount: true,
  summary: true,
  summaryType: true,
  summaryGeneratedAt: true,
  runSummary: true,
  usageByModel: true,
  // Flat cumulative columns: mid-turn events update these but not
  // usageByModel, so the timeline derives the in-flight burn from the
  // difference (LUM-345); liveUsageByModel attributes it per model.
  liveUsageByModel: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheCreationTokens: true,
  loopCount: true,
  // LUM-932: set once `lumo usage resync` corrected this session's figures.
  usageResyncedAt: true,
} satisfies Prisma.SessionSelect

/** LUM-1136: map key for a member × agent pair. */
function memberAgentKey(workspaceMemberId: string, agent: string): string {
  return `${workspaceMemberId}\u0000${agent}`
}

/** LUM-1136: the `cliVersion` write for a hook upsert, or nothing when absent. */
function cliVersionPatch(data: { cliVersion?: string }) {
  return data.cliVersion ? { cliVersion: data.cliVersion } : {}
}

/** Keys per follow-up query, so the OR list stays bounded on big workspaces. */
const MEMBER_AGENT_CHUNK = 100

/**
 * LUM-1136: per member × agent, the `cliVersion` from the newest top-level
 * session since `since` that reported it. Two bounded steps instead of an
 * in-memory `distinct` over every session in the window: groupBy finds each
 * pair's newest reporting timestamp, then only those rows are read (in chunks).
 */
async function latestReportedCliVersion(
  workspaceId: string,
  since: Date
): Promise<
  { workspaceMemberId: string; agent: TaskArtifactAgent; cliVersion: string }[]
> {
  const reported = {
    workspaceId,
    parentSessionId: null,
    lastActivityAt: { gte: since },
    cliVersion: { not: null },
  } satisfies Prisma.SessionWhereInput
  const newest = await prisma.session.groupBy({
    by: ['workspaceMemberId', 'agent'],
    where: reported,
    _max: { lastActivityAt: true },
  })
  const keys = newest.flatMap(g =>
    g._max.lastActivityAt
      ? [
          {
            workspaceMemberId: g.workspaceMemberId,
            agent: g.agent,
            lastActivityAt: g._max.lastActivityAt,
          },
        ]
      : []
  )
  const seen = new Set<string>()
  const out: {
    workspaceMemberId: string
    agent: TaskArtifactAgent
    cliVersion: string
  }[] = []
  for (let i = 0; i < keys.length; i += MEMBER_AGENT_CHUNK) {
    const rows = await prisma.session.findMany({
      where: { ...reported, OR: keys.slice(i, i + MEMBER_AGENT_CHUNK) },
      orderBy: { lastActivityAt: 'desc' },
      select: { workspaceMemberId: true, agent: true, cliVersion: true },
    })
    for (const r of rows) {
      // Two sessions can share the max timestamp; keep the first per pair.
      const k = memberAgentKey(r.workspaceMemberId, r.agent)
      if (r.cliVersion === null || seen.has(k)) continue
      seen.add(k)
      out.push({
        workspaceMemberId: r.workspaceMemberId,
        agent: r.agent,
        cliVersion: r.cliVersion,
      })
    }
  }
  return out
}

export const sessionRepository = {
  /**
   * LUM-1136: per member × agent, the last top-level session activity since
   * `since` — the members page's "last seen" for each connection.
   */
  async lastActivityByMemberAgent(workspaceId: string, since: Date) {
    const rows = await prisma.session.groupBy({
      by: ['workspaceMemberId', 'agent'],
      where: {
        workspaceId,
        parentSessionId: null,
        lastActivityAt: { gte: since },
      },
      _max: { lastActivityAt: true },
    })
    return rows.map(r => ({
      workspaceMemberId: r.workspaceMemberId,
      agent: r.agent,
      lastActivityAt: r._max.lastActivityAt,
    }))
  },

  /**
   * LUM-1136: per member × agent, the latest CLI version reported since
   * `since`, from the newest top-level session that reported it.
   */
  async latestClientVersionsByMemberAgent(workspaceId: string, since: Date) {
    return latestReportedCliVersion(workspaceId, since)
  },

  /** LUM-932: ids of a session's subagent child sessions. */
  async listChildIds(parentSessionId: string): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: { parentSessionId },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-932: upsert a subagent's child session for one hook event. The child
   * inherits the parent's explicit binding on creation (bindingSource
   * INHERITED); a later parent attach is handled by inheritTaskToUnboundChildren.
   * Usage is never written here — a subagent event's `_lumo_usage` is computed
   * from the PARENT transcript and is settled via settleChildUsage instead.
   */
  async upsertChildForHookEvent(data: {
    parentSessionId: string
    agentId: string
    agentType: string | null
    workspaceId: string
    workspaceMemberId: string
    cwd: string | null
    agent?: TaskArtifactAgent
    now: Date
  }): Promise<{ id: string; taskId: string | null; steward: boolean }> {
    const id = buildChildSessionId(data.parentSessionId, data.agentId)
    return prisma.$transaction(async tx => {
      const parent = await ensureParentRow(tx, data)
      // A child carries no role of its own — the steward binding is the parent's.
      const steward = isStewardBinding(parent)
      // Lock order (every binding write): family ROOT row before the child
      // row. The inherit branch below binds the child, so bump the root
      // first when it will apply.
      let bumped = false
      if (parent.taskId) {
        const existingChild = await tx.session.findUnique({
          where: { id },
          select: { taskId: true },
        })
        if (existingChild && existingChild.taskId === null) {
          await bumpFamilyAttributionVersion(tx, id)
          bumped = true
        }
      }
      const child = await tx.session.upsert({
        where: { id },
        create: {
          id,
          workspaceId: data.workspaceId,
          workspaceMemberId: data.workspaceMemberId,
          parentSessionId: data.parentSessionId,
          agentId: data.agentId,
          agentType: data.agentType,
          cwd: data.cwd,
          taskId: parent.taskId,
          bindingSource: parent.taskId ? 'INHERITED' : null,
          ...(data.agent !== undefined ? { agent: data.agent } : {}),
          startedAt: data.now,
          lastActivityAt: data.now,
          eventCount: 1,
        },
        update: {
          lastActivityAt: data.now,
          eventCount: { increment: 1 },
          ...(data.cwd !== null ? { cwd: data.cwd } : {}),
        },
        select: { id: true, taskId: true },
      })
      // An existing unbound child under a parent that has bound since (a
      // parent attach racing this child's earlier creation) inherits now.
      // Conditional on taskId null so a concurrent own attach wins.
      if (child.taskId === null && parent.taskId) {
        const { count } = await tx.session.updateMany({
          where: { id, taskId: null, role: 'IMPLEMENTATION' },
          data: { taskId: parent.taskId, bindingSource: 'INHERITED' },
        })
        if (count > 0) {
          // Raced past the pre-check (child unbound only now): bump late.
          if (!bumped) await bumpFamilyAttributionVersion(tx, id)
          // Explicit (inherited) binding wins over provisional tags.
          await retagEventsToExplicitTask(tx, [id], parent.taskId)
          return { id, taskId: parent.taskId, steward }
        }
      }
      return { ...child, steward }
    })
  },

  /**
   * LUM-932: a parent attach binds the whole session — every child session
   * that has no explicit binding of its own inherits the task, and ALL their
   * events are retagged to it (explicit binding wins over provisional tags;
   * open crossings on provisionally tagged events follow). Already-bound
   * children keep their task.
   */
  async inheritTaskToUnboundChildren(
    parentSessionId: string,
    taskId: string
  ): Promise<{
    childCount: number
    retaggedEventCount: number
    crossingsMoved: number
  }> {
    return prisma.$transaction(async tx => {
      // Lock order (every binding write): family ROOT row first, then child
      // session rows, then their events / crossings.
      await bumpFamilyAttributionVersion(tx, parentSessionId)
      const children = await tx.session.findMany({
        where: { parentSessionId, taskId: null },
        select: { id: true },
      })
      if (children.length === 0)
        return { childCount: 0, retaggedEventCount: 0, crossingsMoved: 0 }
      const ids = children.map(c => c.id)
      await tx.session.updateMany({
        where: { id: { in: ids } },
        data: { taskId, bindingSource: 'INHERITED' },
      })
      const { eventsUpdated, crossingsMoved } = await retagEventsToExplicitTask(
        tx,
        ids,
        taskId
      )
      return {
        childCount: ids.length,
        retaggedEventCount: eventsUpdated,
        crossingsMoved,
      }
    }, RETAG_TX_OPTIONS)
  },

  /**
   * LUM-932: settle one subagent's cumulative usage (from the parent STOP's
   * `_lumo_usage.bySubagent`) onto its child session. The per-call delta is
   * ADDED onto the child's latest SUBAGENT_STOP row so operation cost
   * (lib/agent-run/operation-cost.ts) can attribute it to the subagent's
   * tools; the cumulative columns are then overwritten. Same cumulative twice
   * -> zero delta -> no write (idempotent across resume). No SUBAGENT_STOP row:
   * an eventless child (eventCount 0 — created here, e.g. a subagent that ran
   * before child sessions existed, so no STOP can ever arrive) gets its
   * cumulative written so the usage is not lost; a child with its own hook
   * events is still running and defers until its STOP row exists. `settled`
   * is true only when a STOP row received the delta.
   */
  async settleChildUsage(data: {
    parentSessionId: string
    agentId: string
    workspaceId: string
    workspaceMemberId: string
    usage: InjectedUsage
    now: Date
  }): Promise<{ settled: boolean }> {
    const id = buildChildSessionId(data.parentSessionId, data.agentId)
    return prisma.$transaction(async tx => {
      const childSelect = {
        id: true,
        taskId: true,
        usageByModel: true,
        eventCount: true,
      } as const
      // Common case: the child row exists (its hook events created it), so
      // skip the parent upsert. Only a brand-new child needs its FK target.
      let child = await tx.session.findUnique({
        where: { id },
        select: childSelect,
      })
      if (!child) {
        const parent = await ensureParentRow(tx, data)
        child = await tx.session.upsert({
          where: { id },
          create: {
            id,
            workspaceId: data.workspaceId,
            workspaceMemberId: data.workspaceMemberId,
            parentSessionId: data.parentSessionId,
            agentId: data.agentId,
            taskId: parent.taskId,
            bindingSource: parent.taskId ? 'INHERITED' : null,
            startedAt: data.now,
            lastActivityAt: data.now,
            eventCount: 0,
          },
          update: {},
          select: childSelect,
        })
      }
      const delta = diffUsageByModel(
        (child.usageByModel as Record<string, ModelUsage> | null) ?? null,
        data.usage.byModel
      )
      const cumulative = {
        inputTokens: data.usage.inputTokens,
        outputTokens: data.usage.outputTokens,
        cacheReadTokens: data.usage.cacheReadTokens,
        cacheCreationTokens: data.usage.cacheCreationTokens,
        usageByModel: data.usage.byModel as unknown as Prisma.InputJsonValue,
      }
      if (usageMapTotal(delta) === 0) {
        // Usage drop (see diffUsageByModel): re-baseline the cumulative with
        // nothing added to the SUBAGENT_STOP row — without this the inflated
        // value would stick and swallow later growth. Equal -> no write.
        const stored =
          (child.usageByModel as Record<string, ModelUsage> | null) ?? null
        if (stored && usageMapTotal(data.usage.byModel) < usageMapTotal(stored))
          await tx.session.update({ where: { id }, data: cumulative })
        return { settled: false }
      }
      const stopRow = await tx.hookEvent.findFirst({
        where: { sessionId: id, type: 'SUBAGENT_STOP' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, usageByModel: true },
      })
      if (!stopRow) {
        // A child with its own hook events (eventCount > 0) is a running /
        // background subagent: its SUBAGENT_STOP is still coming, so defer
        // and let the full delta land on that row. A child with NO events
        // was created by this settle path (subagent predates the
        // child-session feature), so a STOP row can never arrive; the parent
        // already excludes this usage, so persist the cumulative or it is
        // lost on every STOP. Nothing is added to a STOP row -> false.
        if (child.eventCount === 0)
          await tx.session.update({ where: { id }, data: cumulative })
        return { settled: false }
      }
      await tx.hookEvent.update({
        where: { id: stopRow.id },
        data: {
          usageByModel: addUsageMaps(
            (stopRow.usageByModel as Record<string, ModelUsage> | null) ?? null,
            delta
          ) as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.session.update({ where: { id }, data: cumulative })
      return { settled: true }
    })
  },

  /**
   * Idempotent per hook event: create the session on first touch, otherwise
   * bump lastActivityAt and eventCount. cwd is backfilled if the first event
   * didn't include it but a later one does. Returns the row's current taskId
   * so the caller can tag the HookEvent without a second query.
   *
   * When `usage` is present, cumulative token columns are OVERWRITTEN (not
   * incremented) — the CLI re-reads the whole transcript each time, so the
   * latest value is the running total. On STOP all columns including
   * usageByModel are settled (with the per-turn delta computed against the
   * prior usageByModel); mid-turn (POST_TOOL_BATCH) writes the flat columns +
   * liveUsageByModel and returns a per-STEP delta (LUM-523) without advancing
   * the STOP usageByModel anchor. `isStop` increments loopCount.
   */
  async upsertForHookEvent(data: UpsertSessionData) {
    // STOP carrying usage: compute the per-turn per-model delta atomically
    // against the prior cumulative, then overwrite cumulative columns.
    if (data.isStop && data.usage) {
      const usage = data.usage
      return prisma.$transaction(async tx => {
        const prior = await tx.session.findUnique({
          where: { id: data.id },
          select: { usageByModel: true, liveUsageByModel: true },
        })
        const turnUsageByModel = diffUsageByModel(
          (prior?.usageByModel as Record<string, ModelUsage> | null) ?? null,
          usage.byModel
        )
        // Usage drop (see diffUsageByModel): a live snapshot larger than this
        // STOP's cumulative is stale-inflated, and pickLatestCumulative would
        // pick it as the next batch's baseline — reset it to the new value.
        // Normally live <= STOP cumulative and it is left untouched.
        const live =
          (prior?.liveUsageByModel as Record<string, ModelUsage> | null) ?? null
        const resetLive =
          live !== null && usageMapTotal(live) > usageMapTotal(usage.byModel)
        const flat = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          usageByModel: usage.byModel as unknown as Prisma.InputJsonValue,
          ...(resetLive
            ? {
                liveUsageByModel:
                  usage.byModel as unknown as Prisma.InputJsonValue,
              }
            : {}),
        }
        const row = await tx.session.upsert({
          where: { id: data.id },
          create: {
            id: data.id,
            workspaceId: data.workspaceId,
            workspaceMemberId: data.workspaceMemberId,
            cwd: data.cwd,
            taskId: null,
            ...(data.agent !== undefined ? { agent: data.agent } : {}),
            ...cliVersionPatch(data),
            startedAt: data.now,
            lastActivityAt: data.now,
            eventCount: 1,
            ...flat,
            loopCount: 1,
          },
          update: {
            lastActivityAt: data.now,
            eventCount: { increment: 1 },
            ...(data.cwd !== null ? { cwd: data.cwd } : {}),
            ...cliVersionPatch(data),
            ...flat,
            loopCount: { increment: 1 },
          },
          select: { id: true, taskId: true, role: true, milestoneId: true },
        })
        return {
          taskId: row.taskId,
          steward: isStewardBinding(row),
          turnUsageByModel,
        }
      })
    }

    // Mid-turn usage (POST_TOOL_BATCH, LUM-345): overwrite the flat cumulative
    // columns + the live per-model snapshot for the delivery card's in-flight
    // burn. LUM-523 ALSO computes a per-STEP delta against the previous snapshot
    // (last batch or last STOP cumulative) and returns it so the caller can
    // store it on the HookEvent row's usageByModel — the per-operation read
    // model buckets these deltas by the tool that ran in the step. The STOP
    // anchor (Session.usageByModel) is still untouched here.
    if (!data.isStop && data.usage) {
      const usage = data.usage
      return prisma.$transaction(async tx => {
        const prior = await tx.session.findUnique({
          where: { id: data.id },
          select: { usageByModel: true, liveUsageByModel: true },
        })
        const baseline = pickLatestCumulative(
          (prior?.usageByModel as Record<string, ModelUsage> | null) ?? null,
          (prior?.liveUsageByModel as Record<string, ModelUsage> | null) ?? null
        )
        const batchStepDelta = diffUsageByModel(baseline, usage.byModel)
        const midTurnFlat = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          liveUsageByModel: usage.byModel as unknown as Prisma.InputJsonValue,
        }
        const row = await tx.session.upsert({
          where: { id: data.id },
          create: {
            id: data.id,
            workspaceId: data.workspaceId,
            workspaceMemberId: data.workspaceMemberId,
            cwd: data.cwd,
            taskId: null,
            ...(data.agent !== undefined ? { agent: data.agent } : {}),
            ...cliVersionPatch(data),
            startedAt: data.now,
            lastActivityAt: data.now,
            eventCount: 1,
            ...midTurnFlat,
          },
          update: {
            lastActivityAt: data.now,
            eventCount: { increment: 1 },
            ...(data.cwd !== null ? { cwd: data.cwd } : {}),
            ...cliVersionPatch(data),
            ...midTurnFlat,
          },
          select: { id: true, taskId: true, role: true, milestoneId: true },
        })
        return {
          taskId: row.taskId,
          steward: isStewardBinding(row),
          turnUsageByModel: batchStepDelta,
        }
      })
    }

    // Non-STOP without usage (or STOP without usage): cheap single upsert.
    const setOnUpdate: Prisma.SessionUpdateInput = {
      lastActivityAt: data.now,
      eventCount: { increment: 1 },
    }
    if (data.cwd !== null) setOnUpdate.cwd = data.cwd
    if (data.isStop) setOnUpdate.loopCount = { increment: 1 }
    if (data.cliVersion) setOnUpdate.cliVersion = data.cliVersion

    const row = await prisma.session.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        cwd: data.cwd,
        taskId: null,
        ...(data.agent !== undefined ? { agent: data.agent } : {}),
        ...cliVersionPatch(data),
        startedAt: data.now,
        lastActivityAt: data.now,
        eventCount: 1,
        ...(data.isStop ? { loopCount: 1 } : {}),
      },
      update: setOnUpdate,
      select: { id: true, taskId: true, role: true, milestoneId: true },
    })
    return {
      taskId: row.taskId,
      steward: isStewardBinding(row),
      turnUsageByModel: null,
    }
  },

  /**
   * Create-or-update a session row with a task binding. Used by
   * `lumo session attach` — the session row may not exist yet (attach
   * happens before any hook fires), so we cannot require it. On an
   * existing row owned by a different member, returns `ownedByOther: true`
   * so the service can throw 403 without a second round-trip.
   */
  async upsertWithTaskId(
    data: UpsertWithTaskIdData
  ): Promise<
    | { ownedByOther: true }
    | { ownedByOther: false; session: { id: string; taskId: string | null } }
  > {
    return prisma.$transaction(async tx => {
      if (data.parentSessionId) {
        await ensureParentRow(tx, {
          parentSessionId: data.parentSessionId,
          workspaceId: data.workspaceId,
          workspaceMemberId: data.workspaceMemberId,
          now: data.now,
          ...(data.agent ? { agent: data.agent } : {}),
        })
      }
      const existing = await tx.session.findUnique({
        where: { id: data.id },
        select: { workspaceMemberId: true },
      })
      if (existing) {
        if (existing.workspaceMemberId !== data.workspaceMemberId) {
          return { ownedByOther: true } as const
        }
        await bumpFamilyAttributionVersion(tx, data.id)
        const updated = await tx.session.update({
          where: { id: data.id },
          data: {
            taskId: data.taskId,
            bindingSource: 'ATTACH',
            ...(data.parentSessionId
              ? {
                  parentSessionId: data.parentSessionId,
                  agentId: data.agentId ?? null,
                }
              : {}),
          },
          select: { id: true, taskId: true },
        })
        return { ownedByOther: false, session: updated } as const
      }
      await bumpFamilyAttributionVersion(tx, data.id)
      const created = await tx.session.create({
        data: {
          id: data.id,
          workspaceId: data.workspaceId,
          workspaceMemberId: data.workspaceMemberId,
          taskId: data.taskId,
          bindingSource: 'ATTACH',
          ...(data.parentSessionId
            ? {
                parentSessionId: data.parentSessionId,
                agentId: data.agentId ?? null,
              }
            : {}),
          ...(data.agent ? { agent: data.agent } : {}),
          startedAt: data.now,
          lastActivityAt: data.now,
          eventCount: 0,
        },
        select: { id: true, taskId: true },
      })
      return { ownedByOther: false, session: created } as const
    })
  },

  /**
   * Create-or-update a session row with a STEWARD milestone binding (LUM-640).
   * Mirrors `upsertWithTaskId` — the row may not exist yet (attach can run
   * before any hook fires) — but stamps `role: STEWARD` alongside the
   * milestoneId. The lifetime-lock checks (already task-bound / bound to a
   * different milestone) live in the service; this is the raw write.
   */
  async upsertWithMilestoneId(data: UpsertWithMilestoneIdData): Promise<
    | { ownedByOther: true }
    | {
        ownedByOther: false
        session: { id: string; milestoneId: string | null }
      }
  > {
    return prisma.$transaction(async tx => {
      const existing = await tx.session.findUnique({
        where: { id: data.id },
        select: { workspaceMemberId: true },
      })
      if (existing) {
        if (existing.workspaceMemberId !== data.workspaceMemberId) {
          return { ownedByOther: true } as const
        }
        await bumpFamilyAttributionVersion(tx, data.id)
        const updated = await tx.session.update({
          where: { id: data.id },
          data: { milestoneId: data.milestoneId, role: 'STEWARD' },
          select: { id: true, milestoneId: true },
        })
        // LUM-932 P3: earlier provisional tags of this family no longer apply.
        await clearProvisionalTagsForSteward(tx, data.id)
        return { ownedByOther: false, session: updated } as const
      }
      await bumpFamilyAttributionVersion(tx, data.id)
      const created = await tx.session.create({
        data: {
          id: data.id,
          workspaceId: data.workspaceId,
          workspaceMemberId: data.workspaceMemberId,
          milestoneId: data.milestoneId,
          role: 'STEWARD',
          startedAt: data.now,
          lastActivityAt: data.now,
          eventCount: 0,
        },
        select: { id: true, milestoneId: true },
      })
      return { ownedByOther: false, session: created } as const
    }, RETAG_TX_OPTIONS)
  },

  /**
   * LUM-640: a session's steward binding, if any — the detector backstop reads
   * this to decide whether an unbound-looking hook event actually belongs to a
   * milestone-bound governance session. Returns null when the session row is
   * missing OR the session is not a STEWARD session with a milestone.
   */
  async findStewardBinding(id: string): Promise<{
    milestoneId: string
    milestoneName: string
  } | null> {
    const row = await prisma.session.findUnique({
      where: { id },
      select: {
        role: true,
        milestone: { select: { id: true, name: true } },
      },
    })
    if (!row || row.role !== 'STEWARD' || !row.milestone) return null
    return {
      milestoneId: row.milestone.id,
      milestoneName: row.milestone.name,
    }
  },

  /**
   * Read the coding agent that owns a session. Used by Layer 1 memory
   * extraction so an auto-sedimented memory inherits the session's agent.
   * Returns null when the session row is missing.
   */
  async findAgent(id: string): Promise<TaskArtifactAgent | null> {
    const row = await prisma.session.findUnique({
      where: { id },
      select: { agent: true },
    })
    return row?.agent ?? null
  },

  /**
   * Attribution projection (LUM-511) for crossings recorded without a hook
   * event: the owner, agent, worktree branch, and cumulative per-model usage
   * needed to fill the LUM-469 attribution view from the session directly.
   * Mirrors `hookEventRepository.findManyByIdsForAttribution`. Skipped when no id.
   */
  async findManyForAttribution(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.session.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workspaceMemberId: true,
        agent: true,
        usageByModel: true,
        worktree: { select: { branch: true } },
      },
    })
  },

  /**
   * Minimal projection for the server-side blocked-tag automation (LUM-544):
   * the bound task and the attribution fields (agent + cumulative per-model
   * usage map). Returns null when the session row is missing.
   */
  async findTaskAndAttribution(id: string): Promise<{
    taskId: string | null
    workspaceId: string
    agent: TaskArtifactAgent
    usageByModel: unknown
  } | null> {
    return prisma.session.findUnique({
      where: { id },
      select: {
        taskId: true,
        workspaceId: true,
        agent: true,
        usageByModel: true,
      },
    })
  },

  /**
   * Resolve a sessionId to its workspace. Used by routes that need to do a
   * workspace-membership check before serving a session-scoped resource.
   */
  async findWorkspaceId(id: string) {
    return prisma.session.findUnique({
      where: { id },
      select: { workspaceId: true },
    })
  },

  /**
   * Ownership-scoped lookup: return the session row + current task binding
   * for the given member, or `null` if the session doesn't exist or belongs
   * to a different member. Used by `lumo session status` and `session
   * detach` so unrelated bearer tokens cannot read or mutate someone else's
   * session.
   */
  async findForMemberWithBinding(sessionId: string, workspaceMemberId: string) {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
        id: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        parentSessionId: true,
        agentType: true,
        // LUM-640: the steward form of the binding — role + milestone ride
        // along so the guard/attach paths can classify without a second read.
        role: true,
        milestone: { select: { id: true, name: true } },
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!row) return null
    return row
  },

  /**
   * Member-scoped read for `lumo session wrap`: returns the bound task (flat
   * identifier) plus the memory-review watermark, or null if the session
   * doesn't exist / belongs to another member. Task fields are null when the
   * session has no binding.
   */
  async findProgressContextForMember(
    sessionId: string,
    workspaceMemberId: string
  ): Promise<{
    taskId: string | null
    taskIdentifier: string | null
    taskTitle: string | null
    lastMemoryReviewAt: Date | null
  } | null> {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
        lastMemoryReviewAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!row) return null
    return {
      taskId: row.task?.id ?? null,
      taskIdentifier: row.task
        ? `${row.task.team.identifier}-${row.task.number}`
        : null,
      taskTitle: row.task?.title ?? null,
      lastMemoryReviewAt: row.lastMemoryReviewAt,
    }
  },

  /** Advance the memory-review watermark after a wrap applies a review. */
  async setLastMemoryReviewAt(sessionId: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { lastMemoryReviewAt: at },
      select: { id: true },
    })
  },

  /**
   * Check whether a session is bound to a task. Used by the session-start
   * hook to return task binding status in the response, so the CLI can
   * inject it into Claude Code's conversation context via stdout.
   */
  async findTaskBinding(
    sessionId: string
  ): Promise<
    | { bound: true; taskId: string; taskIdentifier: string; taskTitle: string }
    | { bound: false }
  > {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        taskId: true,
        task: {
          select: {
            number: true,
            title: true,
            deletedAt: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    // LUM-923: a relation read skips the trash filter — a session bound to a
    // trashed task reads as unbound, so its title never reaches the agent.
    if (!session?.task || !session.taskId || session.task.deletedAt) {
      return { bound: false }
    }
    return {
      bound: true,
      taskId: session.taskId,
      taskIdentifier: `${session.task.team.identifier}-${session.task.number}`,
      taskTitle: session.task.title,
    }
  },

  /**
   * List the TOP-LEVEL sessions that worked on the given task, newest first.
   * Used by `lumo task context` to surface the coding agent's prior runs on a
   * task. Structured summary + summaryType are returned as-is so the caller can
   * project type-appropriate fields (e.g. `summary.unresolved`).
   *
   * LUM-932 P3: explicit sessions bound to the task ∪ unattached sessions the
   * attribution engine inferred onto it (an INFERRED segment for the task),
   * merged by `lastActivityAt` desc under the same limit. Subagent child
   * sessions never take a slot. `inferred: true` marks an unattached session:
   * its cumulative token columns span every task it touched, so callers must
   * not read them as this task's cost.
   */
  async listForTask(taskId: string, limit = 20) {
    const [explicit, inferred] = await Promise.all([
      prisma.session.findMany({
        where: { taskId, parentSessionId: null },
        orderBy: { lastActivityAt: 'desc' },
        take: limit,
        select: TIMELINE_SESSION_SELECT,
      }),
      prisma.session.findMany({
        where: inferredTopLevelSessionsForTask(taskId),
        orderBy: { lastActivityAt: 'desc' },
        take: limit,
        select: TIMELINE_SESSION_SELECT,
      }),
    ])
    return [
      ...explicit.map(s => ({ ...s, inferred: false })),
      ...inferred.map(s => ({ ...s, inferred: true })),
    ]
      .sort(
        (a, b) =>
          b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .slice(0, limit)
  },

  /**
   * LUM-932 (spec §8): subagent child sessions whose work belongs to this task
   * (inherited from a bound parent, or attached on their own). Same projection
   * as {@link listForTask} so the timeline folds their cost into the parent
   * run the same way it computes a parent's.
   */
  async listChildrenForTask(taskId: string) {
    return prisma.session.findMany({
      where: { taskId, parentSessionId: { not: null } },
      select: { ...TIMELINE_SESSION_SELECT, parentSessionId: true },
    })
  },

  /**
   * LUM-932: timeline rows for parent sessions that host a child's work on a
   * task without being bound to it themselves (a subagent attached its own
   * task under an unbound parent).
   */
  async listTimelineRowsByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.session.findMany({
      where: { id: { in: ids } },
      select: TIMELINE_SESSION_SELECT,
    })
  },

  /**
   * The session that immediately precedes `currentSessionId` for the same
   * member, by `lastActivityAt` desc. Self-references off the current
   * session's member so callers don't need to resolve the memberId
   * separately. Returns null when the current session is unknown or it's the
   * member's first session.
   *
   * Used by the Layer 2 session-start review (LUM-165): the PROJECT memories
   * the previous session consolidated are surfaced for review exactly once —
   * at the next session-start. Anchoring on the member (not the task) is
   * deliberate: Layer 2 is project-scoped, so the relevant prior session may
   * have been working a different task in the same project. Uses the
   * `@@index([workspaceMemberId, lastActivityAt])` index.
   */
  async findPreviousSessionIdForMember(
    currentSessionId: string
  ): Promise<string | null> {
    const current = await prisma.session.findUnique({
      where: { id: currentSessionId },
      select: { workspaceMemberId: true },
    })
    if (!current) return null
    const prev = await prisma.session.findFirst({
      where: {
        workspaceMemberId: current.workspaceMemberId,
        id: { not: currentSessionId },
      },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
    return prev?.id ?? null
  },

  async listForMember(workspaceMemberId: string, limit = 50) {
    return prisma.session.findMany({
      where: { workspaceMemberId, parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
      },
    })
  },

  async listForClerkUser(clerkId: string, limit = 50) {
    return prisma.session.findMany({
      where: { member: { clerkId }, parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        taskId: true,
      },
    })
  },

  /**
   * Per top-level session: number of subagent children and the union of task
   * ids touched by the root, its children and their attribution segments.
   * Every requested root gets an entry.
   */
  async summarizeFamilies(
    rootIds: string[]
  ): Promise<Map<string, { subagentCount: number; taskIds: string[] }>> {
    const out = new Map<
      string,
      { subagentCount: number; taskIds: Set<string> }
    >()
    for (const id of rootIds)
      out.set(id, { subagentCount: 0, taskIds: new Set() })
    if (rootIds.length === 0) return new Map()
    const [children, roots] = await Promise.all([
      prisma.session.findMany({
        where: { parentSessionId: { in: rootIds } },
        select: { id: true, parentSessionId: true, taskId: true },
      }),
      prisma.session.findMany({
        where: { id: { in: rootIds } },
        select: { id: true, taskId: true },
      }),
    ])
    const rootOf = new Map<string, string>(rootIds.map(id => [id, id]))
    for (const r of roots) {
      if (r.taskId) out.get(r.id)?.taskIds.add(r.taskId)
    }
    for (const c of children) {
      if (!c.parentSessionId) continue
      rootOf.set(c.id, c.parentSessionId)
      const entry = out.get(c.parentSessionId)
      if (!entry) continue
      entry.subagentCount += 1
      if (c.taskId) entry.taskIds.add(c.taskId)
    }
    const segments = await prisma.taskAttributionSegment.findMany({
      where: { sessionId: { in: [...rootOf.keys()] } },
      select: { sessionId: true, taskId: true },
    })
    for (const seg of segments) {
      const root = rootOf.get(seg.sessionId)
      if (root) out.get(root)?.taskIds.add(seg.taskId)
    }
    return new Map(
      [...out].map(([id, v]) => [
        id,
        { subagentCount: v.subagentCount, taskIds: [...v.taskIds] },
      ])
    )
  },

  /**
   * The /sessions/[id] detail row, unscoped: who may see it is decided by
   * sessionDetailService (LUM-946), which must run before anything is shown.
   */
  async findDetailById(id: string) {
    return prisma.session.findUnique({
      where: { id },
      select: {
        workspaceId: true,
        workspaceMemberId: true,
        member: { select: { clerkId: true } },
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
        summaryEventCount: true,
        parentSessionId: true,
        agentType: true,
        workspace: { select: { slug: true } },
      },
    })
  },

  /** Attribution segments of a top-level session and its direct children. */
  async listFamilyAttribution(rootId: string): Promise<
    {
      sessionId: string
      parentSessionId: string | null
      agentType: string | null
      taskIdentifier: string
      source: AttributionSourceName
      confidence: AttributionConfidenceName
      fromTurn: number
      toTurn: number
      evidence: unknown
    }[]
  > {
    const rows = await prisma.taskAttributionSegment.findMany({
      where: {
        OR: [{ sessionId: rootId }, { session: { parentSessionId: rootId } }],
      },
      orderBy: [{ fromAt: 'asc' }],
      select: {
        sessionId: true,
        source: true,
        confidence: true,
        fromTurn: true,
        toTurn: true,
        evidence: true,
        session: { select: { parentSessionId: true, agentType: true } },
        task: {
          select: { number: true, team: { select: { identifier: true } } },
        },
      },
    })
    return rows.map(r => ({
      sessionId: r.sessionId,
      parentSessionId: r.session.parentSessionId,
      agentType: r.session.agentType,
      taskIdentifier: `${r.task.team.identifier}-${r.task.number}`,
      source: r.source,
      confidence: r.confidence,
      fromTurn: r.fromTurn,
      toTurn: r.toTurn,
      evidence: r.evidence,
    }))
  },

  /**
   * LUM-932 P4: the root session's explicit task binding (null when unbound or
   * missing) — so a bound session with no segment rows yet (pre-P2 history, or
   * attached before the first recompute) still reads as attributed.
   */
  async findRootBinding(rootId: string): Promise<{
    taskIdentifier: string
    bindingSource: 'ATTACH' | 'INHERITED' | null
  } | null> {
    const row = await prisma.session.findUnique({
      where: { id: rootId },
      select: {
        bindingSource: true,
        task: {
          select: { number: true, team: { select: { identifier: true } } },
        },
      },
    })
    if (!row?.task) return null
    return {
      taskIdentifier: `${row.task.team.identifier}-${row.task.number}`,
      bindingSource: row.bindingSource,
    }
  },

  async listChildSessions(rootId: string) {
    return prisma.session.findMany({
      where: { parentSessionId: rootId },
      orderBy: { startedAt: 'asc' },
      select: { id: true, agentType: true },
    })
  },

  async findByIdForMember(id: string, workspaceMemberId: string) {
    return prisma.session.findFirst({
      where: { id, workspaceMemberId },
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
        workspaceId: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
        summaryClassifyModel: true,
        summaryContentModel: true,
        summaryEventCount: true,
      },
    })
  },

  async listEventsForSession(sessionId: string) {
    return prisma.hookEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        toolName: true,
        payload: true,
        createdAt: true,
      },
    })
  },

  async updateSummary(input: {
    id: string
    summary: Prisma.InputJsonValue
    summaryType: string
    generatedAt: Date
    classifyModel: string | null
    contentModel: string
    eventCount: number
  }) {
    return prisma.session.update({
      where: { id: input.id },
      data: {
        summary: storedDerivedFields({ summary: input.summary }, ['summary'])
          .summary,
        summaryType: input.summaryType,
        summaryGeneratedAt: input.generatedAt,
        summaryClassifyModel: input.classifyModel,
        summaryContentModel: input.contentModel,
        summaryEventCount: input.eventCount,
      },
      select: {
        id: true,
        summary: true,
        summaryType: true,
        summaryGeneratedAt: true,
        summaryClassifyModel: true,
        summaryContentModel: true,
        summaryEventCount: true,
      },
    })
  },

  /**
   * Point every session whose `cwd` equals a worktree's path at that worktree
   * (LUM-150 ②). Called when a WORKTREE_CREATE hook fires — the cwd↔path match
   * is how a session is associated with the worktree it runs in, so the
   * collision warning can later name that session's branch. Idempotent.
   */
  async linkToWorktreeByCwd(params: {
    workspaceId: string
    path: string
    worktreeId: string
  }) {
    return prisma.session.updateMany({
      where: { workspaceId: params.workspaceId, cwd: params.path },
      data: { worktreeId: params.worktreeId },
    })
  },

  /**
   * Returns the task title for a given session, used by the cron backstop in
   * the fragment-usage audit (LUM-314). Returns null when the session has no
   * bound task or the session doesn't exist.
   */
  async findTaskTitleForSession(sessionId: string) {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        task: {
          select: {
            title: true,
            // LUM-778: the usage audit reads the constitution per (project, workspace).
            projectId: true,
            project: { select: { workspaceId: true } },
          },
        },
      },
    })
    return row?.task ?? null
  },

  /**
   * Ids of sessions on a task that have no run summary yet (LUM-481),
   * newest-first. LUM-579: returns ids only — the generation service loads each
   * session's full event stream (`listEventsForSession`) and compacts it, rather
   * than reading the sparse STOP-row `turnSummary`s (which systematically
   * under-reported delivery work).
   */
  async listForTaskMissingRunSummary(taskId: string): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: { taskId, runSummary: null, parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-579: ALL session ids on a task, newest-first, regardless of whether a
   * run summary already exists — the force-regeneration path overwrites stale
   * summaries (e.g. the early-biased ones the old sparse-input generation wrote).
   */
  async listSessionIdsForTask(taskId: string): Promise<string[]> {
    const rows = await prisma.session.findMany({
      // LUM-932: subagent children are summarized as part of their parent run.
      where: { taskId, parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-576 backfill: distinct ids of completed (DONE/IN_REVIEW) tasks that
   * still have at least one qualified session missing its runSummary — a
   * session with `runSummary: null` AND ≥1 STOP/STOP_FAILURE event carrying a
   * turnSummary (i.e. generation has material). These are the tasks whose
   * run-summaries were dropped when generation ran fire-and-forget in the
   * cramped task-route waitUntil. The orchestrator re-runs `generateForTask`
   * for each; idempotent — once summarized, the session no longer matches.
   */
  async listCompletedTaskIdsMissingRunSummary(): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: {
        runSummary: null,
        // LUM-932: children never carry a run summary of their own.
        parentSessionId: null,
        task: { status: { in: ['DONE', 'IN_REVIEW'] } },
        events: {
          some: {
            type: { in: ['STOP', 'STOP_FAILURE'] },
            turnSummary: { not: null },
          },
        },
      },
      select: { taskId: true },
      distinct: ['taskId'],
    })
    return rows.map(r => r.taskId).filter((id): id is string => id !== null)
  },

  /**
   * The latest session's run-claim material for a task (LUM-564) — newest by
   * lastActivityAt, the SAME session the web delivery card surfaces as
   * `runs[0]` (sessions list ordered lastActivityAt desc). Returns its LLM
   * `runSummary` plus the raw STOP/STOP_FAILURE turn digest (oldest-first, last
   * MAX lines applied by the caller) so the read model can mirror the web's
   * two-layer claim rule (runSummary, else digest) without drift. Null when the
   * task has no session at all.
   */
  async loadLatestRunClaim(taskId: string) {
    return prisma.session.findFirst({
      // LUM-932: a subagent child is never the task's latest run.
      where: { taskId, parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        // LUM-573: id so the snapshot synthesizer can record which session it
        // selected (provenance) on the fallback (no-MERGED) path.
        id: true,
        runSummary: true,
        events: {
          where: {
            type: { in: ['STOP', 'STOP_FAILURE'] },
            turnSummary: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          select: { turnSummary: true },
        },
      },
    })
  },

  /**
   * LUM-573: run-claim material for SPECIFIC sessions (the authoritative-session
   * resolver picks the ids from MERGED lineage edges; this loads each one's LLM
   * runSummary + STOP turn digest), newest-by-activity first. Mirrors
   * loadLatestRunClaim's per-session select so the same two-layer claim rule
   * applies, but here the RESOLVER — not lastActivityAt across all sessions —
   * decides which session's claim becomes the task's.
   */
  async loadRunClaimForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return []
    return prisma.session.findMany({
      where: { id: { in: sessionIds } },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        lastActivityAt: true,
        runSummary: true,
        events: {
          where: {
            type: { in: ['STOP', 'STOP_FAILURE'] },
            turnSummary: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          select: { turnSummary: true },
        },
      },
    })
  },

  /**
   * LUM-573: distinct ids of all completed (DONE/IN_REVIEW) tasks — the work
   * list for the claim-snapshot backfill. Unlike
   * `listCompletedTaskIdsMissingRunSummary`, this is NOT gated on a session
   * missing its runSummary: the snapshot must be (re)synthesized for tasks whose
   * sessions were ALREADY summarized by the LUM-576 backfill, since those are
   * exactly the tasks the structural 573 bug now surfaces.
   */
  async listCompletedTaskIds(): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { status: { in: ['DONE', 'IN_REVIEW'] } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Persist a generated run summary on a session (LUM-481). `at` doubles as the
   * idempotency watermark so a re-DONE can skip already-summarized sessions.
   */
  async setRunSummary(sessionId: string, summary: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        runSummary: storedDerivedFields({ runSummary: summary }, ['runSummary'])
          .runSummary,
        runSummaryGeneratedAt: at,
      },
      select: { id: true },
    })
  },
}
