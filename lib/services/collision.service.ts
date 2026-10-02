import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { agentLabel } from '@/lib/agents/agent-label'
import { WRITE_TOOLS } from '@/lib/constants/hook-tools'
import { parseChildSessionId } from '@/lib/session/child-session-id'

/** How far back another session's write still counts as a live collision. */
const WINDOW_MS = 30 * 60 * 1000

/** Cap how many other sessions we name before collapsing into a count. */
const MAX_NAMED_SESSIONS = 3

export interface CheckFileCollisionInput {
  workspaceId: string
  /** File the current PreToolUse event is about to write. Null → no check. */
  filePath: string | null
  /** Tool the current event uses. Non-write → no check. */
  toolName: string | null
  /** The current session; its whole family is excluded. Null → no check. */
  sessionId: string | null
  /** Injected clock so the window + relative-time rendering stay testable. */
  now: Date
}

interface OtherSession {
  agent: string
  createdAt: Date
  /** Branch of the other session's worktree, when it's a hook-tracked one. */
  branch: string | null
}

export const collisionService = {
  /**
   * Detect whether another session in the same workspace has written the same
   * file within the recent window, and if so build a one-line warning to inject
   * into the editing agent's context (LUM-150 step ③). Returns null when there's
   * nothing to warn about — including the cheap gate cases that never touch the
   * DB (non-write tool, no file, no session).
   */
  async checkFileCollision(
    input: CheckFileCollisionInput
  ): Promise<{ warning: string } | null> {
    const { workspaceId, filePath, toolName, sessionId, now } = input

    // Cheap gate — no DB query unless this is an identified session writing a
    // known file with a write tool.
    if (!filePath || !sessionId) return null
    if (!toolName || !WRITE_TOOLS.includes(toolName)) return null

    const since = new Date(now.getTime() - WINDOW_MS)
    // LUM-932: a parent and its subagents (child ids `<parent>:<agentId>`) are
    // one session family — exclude the whole family, rooted at the top-level id.
    const familyRoot =
      parseChildSessionId(sessionId)?.parentSessionId ?? sessionId
    const rows = await hookEventRepository.findRecentOtherSessionWritesToFile({
      workspaceId,
      filePath,
      excludeSessionFamilyRoot: familyRoot,
      since,
      toolNames: WRITE_TOOLS,
    })
    if (rows.length === 0) return null

    // Dedupe by session, keeping the most-recent event per session. Rows arrive
    // newest-first, so the first time we see a session is its latest write.
    const bySession = new Map<string, OtherSession>()
    for (const r of rows) {
      if (!r.sessionId || bySession.has(r.sessionId)) continue
      bySession.set(r.sessionId, {
        agent: r.session?.agent ?? 'CLAUDE_CODE',
        createdAt: r.createdAt,
        branch: r.session?.worktree?.branch ?? null,
      })
    }
    if (bySession.size === 0) return null

    return { warning: buildWarning(filePath, [...bySession.values()], now) }
  },
}

function buildWarning(
  filePath: string,
  others: OtherSession[],
  now: Date
): string {
  const named = others
    .slice(0, MAX_NAMED_SESSIONS)
    .map(o => {
      // Branch is more actionable than the agent name when we have it.
      const who = o.branch
        ? `${agentLabel(o.agent)} · branch ${o.branch}`
        : agentLabel(o.agent)
      return `${who} (${relativeTime(o.createdAt, now)})`
    })
    .join(', ')
  const overflow =
    others.length > MAX_NAMED_SESSIONS
      ? ` and ${others.length} sessions in total`
      : ''
  return `⚠️ Lumo parallel-edit warning: session ${named}${overflow} also modified \`${filePath}\` recently — your changes may conflict. Check whether you need to sync before proceeding, to avoid overwriting each other.`
}

/** Render a relative time like "just now" / "3 min ago" / "2 h ago". */
function relativeTime(then: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - then.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}
