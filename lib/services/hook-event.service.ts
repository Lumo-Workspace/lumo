import type { HookEventType, Prisma, TaskArtifactAgent } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

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
    let taskId: string | null = null
    if (sessionId) {
      const session = await sessionRepository.upsertForHookEvent({
        id: sessionId,
        workspaceId: identity.workspace.id,
        workspaceMemberId: memberId,
        cwd,
        ...(agent !== undefined ? { agent } : {}),
        now: new Date(),
      })
      taskId = session.taskId
    }

    const created = await hookEventRepository.createHookEvent({
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      sessionId,
      taskId,
      type,
      toolName: extractStringField(payload, 'tool_name'),
      filePath: extractFilePath(payload),
      payload,
    })

    // Surface the validated sessionId/taskId so per-event side effects (e.g.
    // Stop → Layer 1 memory extraction) can fire-and-forget without
    // re-deriving them.
    return { id: created.id, sessionId, taskId }
  },
}
