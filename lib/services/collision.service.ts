import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { agentLabel } from '@/lib/agents/agent-label'

/**
 * Tool names that mutate a file — the only PreToolUse events worth a collision
 * check. Reading the same file from two sessions isn't a conflict, and gating
 * here means the overwhelming majority of tool calls (Bash, Read, Grep, …) skip
 * the DB query entirely, keeping the per-tool hook well inside its 3s budget.
 */
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

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
  /** The current session, excluded from the lookup. Null → no check. */
  sessionId: string | null
  /** Injected clock so the window + relative-time rendering stay testable. */
  now: Date
}

interface OtherSession {
  agent: string
  createdAt: Date
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
    const rows = await hookEventRepository.findRecentOtherSessionWritesToFile({
      workspaceId,
      filePath,
      excludeSessionId: sessionId,
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
    .map(o => `${agentLabel(o.agent)}（${relativeTime(o.createdAt, now)}）`)
    .join('、')
  const overflow =
    others.length > MAX_NAMED_SESSIONS ? ` 等共 ${others.length} 个会话` : ''
  return `⚠️ Lumo 并行预警：另一个会话 ${named}${overflow} 最近也在改 \`${filePath}\`，可能与你的改动冲突。动手前请确认是否需要先同步，避免互相覆盖。`
}

/** Render a Chinese relative time like "刚刚" / "3 分钟前" / "2 小时前". */
function relativeTime(then: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - then.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}
