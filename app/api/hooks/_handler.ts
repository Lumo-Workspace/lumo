import { NextResponse } from 'next/server'
import { TaskArtifactAgent } from '@prisma/client'
import type { HookEventType, Prisma } from '@prisma/client'
import { verifyBearer } from '@/lib/auth/bearer'
import { hookEventService } from '@/lib/services/hook-event.service'
import {
  redactHookPayload,
  validateHookPayload,
} from '@/lib/validation/hook-payload'
import { extractAttributionSignals } from '@/lib/attribution/signals'
import { classifyBashPayload } from '@/lib/agent-run/bash-category'
import { hookIngestPolicyService } from '@/lib/services/hook-ingest-policy.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * Parse the `X-Lumo-Agent` request header into a TaskArtifactAgent enum value.
 * The CLI hook sends the already-normalized enum token (e.g. `CODEX`), baked in
 * at `lumo setup --agent <token>`. An absent or unrecognized value yields
 * `undefined` so the session falls back to the DB default (CLAUDE_CODE) rather
 * than failing the hook — agent attribution is best-effort metadata.
 */
function parseAgentHeader(request: Request): TaskArtifactAgent | undefined {
  const raw = request.headers.get('x-lumo-agent')
  if (!raw) return undefined
  return raw in TaskArtifactAgent ? (raw as TaskArtifactAgent) : undefined
}

export interface AfterRecordContext {
  /** id of the just-inserted HookEvent row — needed by side effects that
   *  want to write back onto the same row (e.g. turn-summary service
   *  populating HookEvent.turnSummary on STOP rows). */
  eventId: string
  sessionId: string | null
  taskId: string | null
  workspaceId: string
  /** File this event concerns, extracted from the payload (null if none).
   *  Lets the PreToolUse collision check run without re-parsing the payload. */
  filePath: string | null
  /** Tool this event uses, extracted from the payload (null if none). */
  toolName: string | null
  /** The hook payload exactly as persisted (validated, credential-redacted and,
   *  in USED_UP workspaces, stripped of customer code — LUM-855 / LUM-933),
   *  for side effects that need fields beyond the common ones above (e.g.
   *  WORKTREE_CREATE → worktree_path/branch). Anything a side effect writes
   *  back to the DB must come from here, never from `rawPayload`. */
  payload: unknown
  /** The validated payload BEFORE credential redaction (LUM-859). In memory
   *  only — reserved for the boundary detector, whose secret checks
   *  (HARDCODED_SECRET …) need the original text. Never persist it. */
  rawPayload: unknown
}

export interface HandleHookOptions {
  /**
   * Optional per-event side effect, invoked after the HookEvent row is
   * persisted but before the response is returned. Routes that need to
   * fire-and-forget background work (e.g. STOP → memory extraction) wrap
   * the call here in `waitUntil(...)` so the response isn't blocked but the
   * function instance stays alive long enough to finish.
   *
   * Must not throw; the caller treats this as best-effort.
   */
  afterRecord?: (
    ctx: AfterRecordContext,
    identity: VerifyApiKeyResult
  ) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>
}

export async function handleHookRequest(
  request: Request,
  type: HookEventType,
  options: HandleHookOptions = {}
): Promise<Response> {
  try {
    const identity = await verifyBearer(request)
    if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

    let rawPayload: unknown
    try {
      rawPayload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Boundary validation (LUM-348): assert key-field types and cap free-text
    // size before anything is persisted. Sanitize-and-mark, never 4xx — hooks
    // are best-effort, so a malformed payload degrades to a marked event
    // instead of breaking the event stream. Everything downstream (service
    // extraction, afterRecord side effects) sees only the sanitized payload.
    const { payload: validated } = validateHookPayload(type, rawPayload)
    // LUM-859: credentials are redacted out of the copy that is stored (and
    // out of every column derived from it). The unredacted `validated` stays
    // in memory for the boundary detector only — see AfterRecordContext.
    // LUM-933: whether code is also stripped from that stored copy (LUM-855:
    // paths, commands and sizes stay) is the workspace's session record mode —
    // only USED_UP strips; RETAIN (the default) keeps it. Credentials are
    // redacted in every mode. `validated` keeps both.
    const redacted = redactHookPayload(validated).payload
    const payload = await hookIngestPolicyService.storedPayloadFor(
      identity.workspace.id,
      type,
      redacted
    )
    // LUM-932: attribution signals are extracted from the redacted-but-not-
    // stripped payload. Code stripping replaces everything under
    // `tool_response` (including `agentId`), which would drop the AGENT_PROMPT
    // link between a dispatch prompt and its spawned subagent. Signals carry
    // only identifiers, branch and agent id - never code.
    const attributionSignals = extractAttributionSignals(type, redacted)
    // LUM-873: same for the Bash category — a used-up workspace stores only a
    // summary of the command (heredoc bodies dropped, capped), so the command
    // is classified on the full text before stripping.
    const bashClassification = classifyBashPayload(redacted)

    const agent = parseAgentHeader(request)
    const recorded = await hookEventService.recordHookEvent({
      identity,
      type,
      payload: payload as Prisma.InputJsonValue,
      attributionSignals,
      bashClassification,
      ...(agent !== undefined ? { agent } : {}),
    })

    let extra: Record<string, unknown> | void | undefined
    if (options.afterRecord) {
      try {
        extra = await options.afterRecord(
          {
            eventId: recorded.id,
            sessionId: recorded.sessionId,
            taskId: recorded.taskId,
            workspaceId: identity.workspace.id,
            filePath: recorded.filePath,
            toolName: recorded.toolName,
            payload,
            rawPayload: validated,
          },
          identity
        )
      } catch (sideEffectError) {
        // afterRecord is best-effort; never let a side-effect failure flip the
        // hook response to 500 once the event is already persisted.
        console.error(
          `POST /api/hooks/${type} afterRecord error:`,
          sideEffectError
        )
      }
    }

    return NextResponse.json({ ok: true, ...extra })
  } catch (error) {
    // Only propagate statuses that Lumo's own services explicitly throw
    // (today: 403 from hookEventService for missing workspace membership).
    // An unknown 4xx from a third-party lib could leak internal messages,
    // so we force it to 500. Expand this allowlist when new service-level
    // 4xx errors are introduced.
    const status = (error as { status?: number } | null)?.status
    if (status === 403) {
      const message = error instanceof Error ? error.message : 'Forbidden'
      return NextResponse.json({ error: message }, { status: 403 })
    }
    console.error(`POST /api/hooks/${type} error:`, error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
