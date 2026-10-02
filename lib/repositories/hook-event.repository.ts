import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { eventsForTask } from '@/lib/repositories/task-attribution-where'
import {
  bumpFamilyAttributionVersion,
  retagEventsToExplicitTask,
} from '@/lib/repositories/explicit-retag'
import { RETAG_TX_OPTIONS } from '@/lib/repositories/open-crossing-move'
import type { HookEventType } from '@prisma/client'
import type { AttributionSignal } from '@/lib/attribution/signals'
import type { ToolEventRow } from '@/lib/session/resolve-caller'

// ── Types ────────────────────────────────────────────────────────────────────

interface CreateHookEventData {
  workspaceId: string
  workspaceMemberId: string
  type: HookEventType
  toolName: string | null
  /** LUM-840: purpose bucket under `toolName` (Bash category slug); null otherwise. */
  toolDetail?: string | null
  /** LUM-840: the command that decided `toolDetail` (e.g. `jest`, `git show`); null otherwise. */
  toolVerb?: string | null
  payload: Prisma.InputJsonValue
  sessionId?: string | null
  taskId?: string | null
  /**
   * File this event concerns, lifted out of the raw payload by the service so
   * it's queryable/indexable (cross-session "who touched this file" lookups,
   * LUM-146 "last file changed"). Null for events that carry no file path.
   */
  filePath?: string | null
  /** Per-turn delta on STOP rows; per-step delta on POST_TOOL_BATCH rows (LUM-523). Null elsewhere. */
  usageByModel?: Prisma.InputJsonValue | null
  /** LUM-932 P2: task-identification signals extracted at record time; `[]` when none found (SQL NULL is reserved for rows never computed). */
  attributionSignals?: AttributionSignal[] | null
}

interface FindRecentOtherSessionWritesParams {
  workspaceId: string
  filePath: string
  /**
   * Root (top-level) session id of the caller's session family. The root and
   * every child `<root>:<agentId>` (LUM-932 subagent sessions) are excluded,
   * so a session never collides with itself, its own subagents, or siblings.
   */
  excludeSessionFamilyRoot: string
  /** Lower bound on createdAt — the caller's collision time window. */
  since: Date
  /** Tool names that count as a write (caller owns this policy). */
  toolNames: string[]
}

// ── HookEvent Repository ──────────────────────────────────────────────────────

export const hookEventRepository = {
  /**
   * LUM-932: recent Bash Pre/Post tool events across a session family, for
   * matching a CLI call to the session that issued it. Bounded by `since`
   * (the caller passes a two-minute window) so the scan stays small.
   */
  async findRecentBashToolEventsInSessions(
    sessionIds: string[],
    since: Date
  ): Promise<ToolEventRow[]> {
    if (sessionIds.length === 0) return []
    const rows = await prisma.hookEvent.findMany({
      where: {
        sessionId: { in: sessionIds },
        toolName: 'Bash',
        type: {
          in: ['PRE_TOOL_USE', 'POST_TOOL_USE', 'POST_TOOL_USE_FAILURE'],
        },
        createdAt: { gte: since },
      },
      select: { sessionId: true, type: true, createdAt: true, payload: true },
      orderBy: { createdAt: 'asc' },
    })
    return rows.filter(
      (r): r is typeof r & { sessionId: string } => r.sessionId !== null
    ) as ToolEventRow[]
  },

  /**
   * LUM-772: the Bash command each of these events carried
   * (`payload.tool_input.command`), keyed by event id. Events without a
   * readable command are absent from the map. Used by the crossing backfill
   * to re-judge on the FULL command rather than the clipped `detail`.
   */
  async findCommandsByIds(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (ids.length === 0) return out
    const rows = await prisma.hookEvent.findMany({
      where: { id: { in: ids } },
      select: { id: true, payload: true },
    })
    for (const row of rows) {
      const payload = row.payload as {
        tool_input?: { command?: unknown }
      } | null
      const command = payload?.tool_input?.command
      if (typeof command === 'string') out.set(row.id, command)
    }
    return out
  },

  /** Record a Claude Code hook event for audit and activity tracking. */
  async createHookEvent(data: CreateHookEventData) {
    return prisma.hookEvent.create({
      data: {
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        sessionId: data.sessionId ?? null,
        taskId: data.taskId ?? null,
        type: data.type,
        toolName: data.toolName,
        toolDetail: data.toolDetail ?? null,
        toolVerb: data.toolVerb ?? null,
        filePath: data.filePath ?? null,
        payload: data.payload,
        usageByModel:
          data.usageByModel != null
            ? (data.usageByModel as Prisma.InputJsonValue)
            : Prisma.DbNull,
        attributionSignals:
          data.attributionSignals != null
            ? (data.attributionSignals as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
      select: { id: true },
    })
  },

  /**
   * Fetch hook events by id, narrowed to the fields the LUM-452 edit-change read
   * model needs (toolName + the raw payload it pulls old/new/content from). Used
   * by the boundary-crossing read model to surface a display-safe crossing's
   * triggering edit inline. `sessionId`/`createdAt` (LUM-455) locate the turn the
   * edit belongs to, for the turn-intent line.
   */
  async findManyByIdsForEditChange(ids: string[]) {
    return prisma.hookEvent.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        toolName: true,
        payload: true,
        sessionId: true,
        createdAt: true,
      },
    })
  },

  /**
   * Fetch hook events by id, narrowed to the fields the LUM-469 attribution read
   * model needs: the owning member, the session it fired in (+ that session's
   * agent type and worktree branch), the raw payload (a best-effort model may be
   * carried there), and `createdAt` to correlate the turn's usageByModel. A pure
   * read — joins one level into the session for agent/branch. Skipped entirely
   * when a task has no crossing with a linked hook event.
   */
  async findManyByIdsForAttribution(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.hookEvent.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workspaceMemberId: true,
        sessionId: true,
        payload: true,
        createdAt: true,
        session: {
          select: {
            agent: true,
            worktree: { select: { branch: true } },
          },
        },
      },
    })
  },

  /**
   * Every STOP / STOP_FAILURE row carrying a per-turn `usageByModel` delta
   * (LUM-298) for the given sessions, oldest-first — the raw signal the LUM-469
   * attribution read model correlates to name the model that ran for the turn a
   * crossing's edit belongs to. Mirrors `findTurnSummariesForSessions` but
   * projects `usageByModel` instead of `turnSummary`. Skipped when no session id.
   */
  async findTurnUsageForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return []
    return prisma.hookEvent.findMany({
      where: {
        sessionId: { in: sessionIds },
        type: { in: ['STOP', 'STOP_FAILURE'] },
        usageByModel: { not: Prisma.DbNull },
      },
      orderBy: { createdAt: 'asc' },
      select: { sessionId: true, createdAt: true, usageByModel: true },
    })
  },

  /**
   * Every STOP / STOP_FAILURE row (with its LLM turn summary) for the given
   * sessions, oldest-first (LUM-455). The boundary-crossing read model uses these
   * to attach the summary of the turn an edit belongs to — the closest available
   * proxy for "why the agent made this edit", since Claude Code's PostToolUse
   * payload carries no per-edit reason. Skipped entirely when no session id.
   */
  async findTurnSummariesForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return []
    return prisma.hookEvent.findMany({
      where: {
        sessionId: { in: sessionIds },
        type: { in: ['STOP', 'STOP_FAILURE'] },
        turnSummary: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { sessionId: true, createdAt: true, turnSummary: true },
    })
  },

  /**
   * Full event stream for the given sessions used by `lib/agent-run/active-time`
   * to derive agent ACTIVE time (excludes inter-turn idle AND mid-turn human-wait
   * intervals marked by PERMISSION_REQUEST / NOTIFICATION / ELICITATION).
   * The wider type list lets the algorithm see human-wait markers within each
   * turn; events that are not anchored to a turn are silently ignored.
   * Skipped when no session id.
   */
  async findTurnBoundaryEventsForSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) return []
    return prisma.hookEvent.findMany({
      where: {
        sessionId: { in: sessionIds },
        type: {
          in: [
            'USER_PROMPT_SUBMIT',
            'STOP',
            'STOP_FAILURE',
            'PRE_TOOL_USE',
            'POST_TOOL_USE',
            'POST_TOOL_USE_FAILURE',
            'POST_TOOL_BATCH',
            'SUBAGENT_START',
            'SUBAGENT_STOP',
            'PERMISSION_REQUEST',
            'PERMISSION_DENIED',
            'NOTIFICATION',
            'ELICITATION',
            'ELICITATION_RESULT',
          ],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { sessionId: true, type: true, createdAt: true },
    })
  },

  /**
   * Recent write events to `filePath` from sessions other than the caller's,
   * within the `since` window — the raw signal for the parallel-edit collision
   * warning (LUM-150 step ③). Index-served by
   * `@@index([workspaceId, filePath, createdAt])`; toolName/session are residual
   * filters on the already-narrow path+time slice. Returns up to 50 rows newest-
   * first (the service dedupes them by session); each row carries its session's
   * `agent` so the warning can name who else is editing.
   */
  async findRecentOtherSessionWritesToFile(
    params: FindRecentOtherSessionWritesParams
  ) {
    return prisma.hookEvent.findMany({
      where: {
        workspaceId: params.workspaceId,
        filePath: params.filePath,
        // Null sessionIds stay excluded (as with the former `not` filter).
        sessionId: { not: null },
        NOT: [
          { sessionId: params.excludeSessionFamilyRoot },
          { sessionId: { startsWith: `${params.excludeSessionFamilyRoot}:` } },
        ],
        createdAt: { gte: params.since },
        toolName: { in: params.toolNames },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        sessionId: true,
        toolName: true,
        createdAt: true,
        // agent + (when the session is linked to a hook-tracked worktree) its
        // branch — both feed the collision warning's "who else" label.
        session: {
          select: { agent: true, worktree: { select: { branch: true } } },
        },
      },
    })
  },

  /**
   * Pull every already-emitted event of a session under the task it was just
   * explicitly attached to (`lumo session attach`). Explicit binding wins
   * (LUM-932 P3): events carrying a provisional (inferred) task are retagged
   * too, and the undispositioned crossings on them move to the attached task.
   * Safe because attach only binds an unbound session or re-binds the same
   * task (LUM-459). `eventsUpdated` = events whose taskId changed.
   */
  async retagSessionEventsToExplicitTask(
    sessionId: string,
    taskId: string
  ): Promise<{ eventsUpdated: number; crossingsMoved: number }> {
    return prisma.$transaction(async tx => {
      await bumpFamilyAttributionVersion(tx, sessionId)
      return retagEventsToExplicitTask(tx, [sessionId], taskId)
    }, RETAG_TX_OPTIONS)
  },

  /**
   * Persist the LLM-generated turn summary onto a STOP / STOP_FAILURE
   * row. Best-effort — if the event row was already deleted (run reset,
   * workspace cascade) we swallow the P2025 silently rather than throw,
   * since the caller is fire-and-forget.
   */
  async setTurnSummary(eventId: string, summary: string) {
    try {
      await prisma.hookEvent.update({
        where: { id: eventId },
        data: { turnSummary: summary },
        select: { id: true },
      })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code !== 'P2025') throw error
    }
  },

  /**
   * Persist the server-computed session-start injection metrics by replacing
   * the SESSION_START row's payload with `payloadWithMetrics` — the original
   * boundary-validated payload plus the `_lumo_context_metrics` reserved key
   * (LUM-402). The caller owns the merge; nothing else writes a SESSION_START
   * payload after insert, so the replace cannot race another writer.
   * Best-effort like `setTurnSummary` — a vanished row (P2025) is swallowed
   * because the caller is fire-and-forget.
   */
  async setContextInjectionMetrics(
    eventId: string,
    payloadWithMetrics: Prisma.InputJsonValue
  ) {
    try {
      await prisma.hookEvent.update({
        where: { id: eventId },
        data: { payload: payloadWithMetrics },
        select: { id: true },
      })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      if (code !== 'P2025') throw error
    }
  },

  /**
   * All hook events for a task, ordered by time. Used by the Agent Run
   * timeline to reconstruct what Claude Code did during each session.
   *
   * Per-event taskId takes precedence over session.taskId so a session
   * that was re-tagged mid-flight (`lumo session attach <other-task>`)
   * routes each event to the task that was active when it fired:
   *   1. HookEvent.taskId set → only the matching task sees this event.
   *   2. HookEvent.taskId NULL → fall through to Session.taskId (the
   *      legacy bucket — covers events written before the per-event tag
   *      fix as well as sessions that never switched).
   *
   * Without the `taskId IS NULL` guard on branch 2, an event that was
   * explicitly tagged for the new task would also leak into the old
   * task's timeline via session.taskId, causing duplicate display.
   */
  async findByTaskId(taskId: string) {
    return prisma.hookEvent.findMany({
      where: eventsForTask(taskId),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sessionId: true,
        type: true,
        toolName: true,
        payload: true,
        turnSummary: true,
        usageByModel: true,
        createdAt: true,
      },
    })
  },

  /**
   * Per-turn token deltas (LUM-298) for a task, used by the lineage cost view
   * (LUM-301) to attribute "what this task actually burned" instead of a
   * session's ever-growing cumulative columns. Returns one row per STOP /
   * STOP_FAILURE turn that carries a `usageByModel` delta, with the session it
   * fired in so the caller can sum per session group.
   *
   * Same task-attribution precedence as `findByTaskId`: an event's own taskId
   * wins; only NULL-taskId events fall through to their session's binding (the
   * `taskId IS NULL` guard stops a re-tagged event leaking into the old task).
   */
  async findTurnUsageByTask(taskId: string) {
    return prisma.hookEvent.findMany({
      where: {
        ...eventsForTask(taskId),
        type: { in: ['STOP', 'STOP_FAILURE'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      // createdAt: LUM-559 dates the edgeless cost-only group a session gets
      // when it had per-turn cost but recorded no lineage edge.
      select: { sessionId: true, usageByModel: true, createdAt: true },
    })
  },

  /**
   * Failure events for a session, oldest-first — the raw signal for the
   * `lumo session wrap` blocked-tag prompt (LUM-153). Returns both explicit
   * tool failures (`POST_TOOL_USE_FAILURE`, carrying `toolName` + the raw
   * payload that holds the error text) and turn-level failures
   * (`STOP_FAILURE`, carrying an LLM `turnSummary`). Index-served by
   * `@@index([sessionId, createdAt])`. The caller aggregates these by type to
   * decide whether the same failure recurred ≥ threshold times.
   */
  async findFailuresBySession(sessionId: string) {
    return prisma.hookEvent.findMany({
      where: {
        sessionId,
        type: { in: ['POST_TOOL_USE_FAILURE', 'STOP_FAILURE'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        type: true,
        toolName: true,
        turnSummary: true,
        payload: true,
        createdAt: true,
      },
    })
  },

  /**
   * LUM-172 共享文件 sweep:since 之后写工具事件的 (workspaceId, taskId, filePath)
   * 去重三元组。taskId 取 HookEvent 自带列(session 绑定时已回填)。
   * 注意:Prisma groupBy 对 nullable 列的返回类型仍是 string|null(where 过滤不收窄
   * 类型),调用方需自行 narrow;结果集无 take 上限,边界由调用方的时间窗+阈值控制。
   */
  async groupTaskFilesTouched(opts: { since: Date; toolNames: string[] }) {
    return prisma.hookEvent.groupBy({
      by: ['workspaceId', 'taskId', 'filePath'],
      where: {
        createdAt: { gte: opts.since },
        taskId: { not: null },
        filePath: { not: null },
        toolName: { in: opts.toolNames },
      },
    })
  },

  /**
   * Raw events for the per-operation cost read model (LUM-523): the tool-result
   * rows (carry toolName) + the batch rows (carry per-step usageByModel delta) +
   * the STOP rows (carry per-turn usageByModel delta, for the thinking residual),
   * ordered per session by time. Three scopes: a task (same taskId precedence as
   * findByTaskId), a single session (workspace-scoped so a session id from
   * another workspace can never be read), or a workspace window.
   */
  async findToolAttributionEvents(
    scope:
      | { taskId: string }
      | { sessionId: string; workspaceId: string }
      | { workspaceId: string; since: Date }
  ) {
    const type: Prisma.HookEventWhereInput['type'] = {
      in: [
        'POST_TOOL_USE',
        'POST_TOOL_USE_FAILURE',
        'POST_TOOL_BATCH',
        'STOP',
        'STOP_FAILURE',
        // LUM-932: subagent (child session) turns settle on SUBAGENT_STOP;
        // the pure attribution ignores it on top-level sessions.
        'SUBAGENT_STOP',
      ],
    }
    const where: Prisma.HookEventWhereInput =
      'taskId' in scope
        ? {
            ...eventsForTask(scope.taskId),
            type,
          }
        : 'sessionId' in scope
          ? { type, sessionId: scope.sessionId, workspaceId: scope.workspaceId }
          : {
              type,
              workspaceId: scope.workspaceId,
              createdAt: { gte: scope.since },
            }
    return prisma.hookEvent.findMany({
      where,
      orderBy: [{ sessionId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        sessionId: true,
        workspaceMemberId: true,
        type: true,
        toolName: true,
        toolDetail: true,
        toolVerb: true,
        usageByModel: true,
        createdAt: true,
      },
    })
  },
}
