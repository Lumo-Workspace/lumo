import type { HookEventType, Prisma, TaskArtifactAgent } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import type { ModelUsage } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'
import { classifyBashPayload } from '@/lib/agent-run/bash-category'
import {
  parseInjectedUsage,
  splitSubagentUsage,
  type InjectedUsage,
} from '@/lib/session/subagent-usage'
import {
  extractAttributionSignals,
  type AttributionSignal,
} from '@/lib/attribution/signals'
import { logger } from '@/lib/logger'
import { AGENT_ID_RE } from '@/lib/session/child-session-id'

interface RecordHookEventInput {
  identity: VerifyApiKeyResult
  type: HookEventType
  payload: Prisma.InputJsonValue
  /**
   * Coding agent that produced this hook, parsed from the `X-Lumo-Agent`
   * request header. Forwarded to the session upsert so it's recorded once on
   * the session's first event. Undefined when absent/invalid — the DB default
   * (CLAUDE_CODE) then applies.
   */
  agent?: TaskArtifactAgent
  /**
   * Signals extracted by the caller from the credential-redacted payload
   * BEFORE code stripping (which erases `tool_response.agentId`). When absent
   * they are extracted from `payload`.
   */
  attributionSignals?: AttributionSignal[]
}

function extractStringField(payload: unknown, field: string): string | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function extractNestedStringField(
  payload: unknown,
  parent: string,
  field: string
): string | null {
  if (payload && typeof payload === 'object') {
    const nested = (payload as Record<string, unknown>)[parent]
    return extractStringField(nested, field)
  }
  return null
}

/**
 * Lift the file path a hook event concerns out of its raw payload, so it can
 * be stored on an indexed `HookEvent.filePath` column instead of staying buried
 * in unqueryable JSON. Checks, in priority order, the locations Claude Code uses
 * across event shapes:
 *   1. `tool_input.file_path` — Read/Edit/MultiEdit/Write tool events
 *      (`tool_input.notebook_path` for NotebookEdit, LUM-904)
 *   2. `tool_response.filePath` — Write/Edit PostToolUse responses
 *   3. top-level `path` / `file_path` — FILE_CHANGED, CONFIG_CHANGE,
 *      INSTRUCTIONS_LOADED
 * Returns null for events that carry no file path (Bash, Stop, prompts, …).
 * Payload-shape-driven rather than type-driven: a Bash tool_input has no
 * file_path, so it naturally yields null without enumerating event types.
 */
export function extractFilePath(payload: unknown): string | null {
  return (
    extractNestedStringField(payload, 'tool_input', 'file_path') ??
    extractNestedStringField(payload, 'tool_input', 'notebook_path') ??
    extractNestedStringField(payload, 'tool_response', 'filePath') ??
    extractStringField(payload, 'path') ??
    extractStringField(payload, 'file_path')
  )
}

export const hookEventService = {
  async recordHookEvent({
    identity,
    type,
    payload,
    agent,
    attributionSignals,
  }: RecordHookEventInput) {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(
        new Error('Workspace member not found for API key holder'),
        { status: 403 }
      )
    }

    const sessionId = extractStringField(payload, 'session_id')
    const cwd = extractStringField(payload, 'cwd')

    // Upsert Session before the HookEvent insert so the FK resolves, and
    // read back Session.taskId — server-authoritative now that the CLI no
    // longer carries a per-session sentinel. If session_id is missing
    // (malformed or non-Claude-Code client), record the event unlinked
    // (matches Day 3 tolerance) with no taskId tag.
    const isStop = type === 'STOP' || type === 'STOP_FAILURE'
    // POST_TOOL_BATCH also carries usage (LUM-345) so long single turns
    // surface live burn. The repository writes the Session flat columns +
    // liveUsageByModel and returns a per-STEP delta (LUM-523) stored on this
    // HookEvent row's usageByModel; the Session.usageByModel STOP anchor that
    // the per-turn-delta diff settles against stays untouched.
    // An agent_id that cannot form a child session id is treated as absent —
    // the event stays on the parent rather than failing the hook.
    const rawAgentId = extractStringField(payload, 'agent_id')
    const agentId =
      rawAgentId !== null && AGENT_ID_RE.test(rawAgentId) ? rawAgentId : null
    const agentType = extractStringField(payload, 'agent_type')

    let recordedSessionId: string | null = sessionId
    let taskId: string | null = null
    let turnUsageByModel: Record<string, ModelUsage> | null = null
    let childUsageToSettle: [string, InjectedUsage][] = []
    if (sessionId && agentId) {
      // LUM-932: an event emitted inside a subagent lands on its child
      // session. Its `_lumo_usage` (if any) was computed from the PARENT
      // transcript, so it is ignored here — subagent usage is settled from
      // the parent STOP's `bySubagent` below.
      const child = await sessionRepository.upsertChildForHookEvent({
        parentSessionId: sessionId,
        agentId,
        agentType,
        workspaceId: identity.workspace.id,
        workspaceMemberId: memberId,
        cwd,
        ...(agent !== undefined ? { agent } : {}),
        now: new Date(),
      })
      recordedSessionId = child.id
      taskId = child.taskId
    } else if (sessionId) {
      const injected =
        isStop || type === 'POST_TOOL_BATCH'
          ? parseInjectedUsage(payload)
          : null
      // LUM-932: the CLI's totals include subagent transcripts; the parent
      // keeps only its own share so nothing is counted twice.
      const split = injected ? splitSubagentUsage(injected) : null
      const session = await sessionRepository.upsertForHookEvent({
        id: sessionId,
        workspaceId: identity.workspace.id,
        workspaceMemberId: memberId,
        cwd,
        ...(agent !== undefined ? { agent } : {}),
        now: new Date(),
        usage: split ? split.main : null,
        isStop,
      })
      taskId = session.taskId
      turnUsageByModel = session.turnUsageByModel
      if (isStop && split) {
        childUsageToSettle = Object.entries(split.bySubagent)
      }
    }

    const toolName = extractStringField(payload, 'tool_name')
    const bash = classifyBashPayload(payload)
    const filePath = extractFilePath(payload)
    const signals =
      attributionSignals ?? extractAttributionSignals(type, payload)
    const created = await hookEventRepository.createHookEvent({
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      sessionId: recordedSessionId,
      taskId,
      type,
      toolName,
      toolDetail: bash?.category ?? null,
      toolVerb: bash?.verb ?? null,
      filePath,
      payload,
      usageByModel:
        turnUsageByModel != null
          ? (turnUsageByModel as unknown as Prisma.InputJsonValue)
          : null,
      // [] = computed, nothing found (vs NULL = historical, never computed).
      attributionSignals: signals,
    })

    // LUM-932: settle each subagent's usage onto its child session AFTER the
    // STOP event is recorded — best-effort, so one failed settlement never
    // blocks the STOP row, the other settlements, or the hook response.
    if (sessionId) {
      for (const [subAgentId, subUsage] of childUsageToSettle) {
        try {
          await sessionRepository.settleChildUsage({
            parentSessionId: sessionId,
            agentId: subAgentId,
            workspaceId: identity.workspace.id,
            workspaceMemberId: memberId,
            usage: subUsage,
            now: new Date(),
          })
        } catch (error) {
          logger.error(
            'hookEventService.recordHookEvent settleChildUsage error:',
            error
          )
        }
      }
    }

    // Surface the validated sessionId/taskId plus the extracted toolName/filePath
    // so per-event side effects (Stop → Layer 1 memory extraction, PreToolUse →
    // collision check) can act without re-deriving them from the raw payload.
    return {
      id: created.id,
      sessionId: recordedSessionId,
      taskId,
      toolName,
      filePath,
    }
  },
}
