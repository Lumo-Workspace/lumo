/**
 * LUM-932: a subagent's child Session id is `<parentSessionId>:<agentId>`.
 * Claude Code session ids are UUIDs (no `:`), and agent ids are short
 * alphanumerics, so the separator is unambiguous and the id deterministic —
 * a subagent resumed via SendMessage keeps its agent_id and lands on the same
 * row.
 */
export const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function buildChildSessionId(
  parentSessionId: string,
  agentId: string
): string {
  if (!parentSessionId || parentSessionId.includes(':')) {
    throw new Error('invalid parent session id')
  }
  if (!AGENT_ID_RE.test(agentId)) throw new Error('invalid agent id')
  return `${parentSessionId}:${agentId}`
}

export function parseChildSessionId(
  id: string
): { parentSessionId: string; agentId: string } | null {
  const idx = id.indexOf(':')
  if (idx <= 0) return null
  const parentSessionId = id.slice(0, idx)
  const agentId = id.slice(idx + 1)
  if (!AGENT_ID_RE.test(agentId)) return null
  return { parentSessionId, agentId }
}
