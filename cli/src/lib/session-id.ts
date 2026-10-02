import { readCredentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

/** Thrown when two sessions of one family run the same lumo command at once. */
export class AmbiguousSessionError extends Error {
  constructor() {
    super(
      'Two sessions of this Claude Code session (e.g. two subagents) are running the same lumo command right now, so Lumo cannot tell which one this is. Re-run it once the other finishes.'
    )
    this.name = 'AmbiguousSessionError'
  }
}

/**
 * LUM-932: the Lumo session id this CLI call belongs to. Claude Code gives a
 * subagent the parent's CLAUDE_CODE_SESSION_ID, so the server matches this
 * call's argv against the pending Bash command it just recorded and returns
 * the subagent's child session when that is who issued it. No command is
 * rewritten — permission behavior is untouched. Any failure falls back to the
 * raw CLAUDE_CODE_SESSION_ID (today's behavior). On ambiguity a write throws
 * AmbiguousSessionError; a read uses the parent id.
 */
type ResolveBody = { sessionId?: unknown; resolution?: unknown }

// One resolve per process: later calls reuse the answer (including fallbacks).
let cached: Promise<ResolveBody> | undefined

/** Test-only: forget the cached resolve response. */
export function __resetSessionIdCacheForTests(): void {
  cached = undefined
}

async function fetchResolution(
  sessionId: string,
  creds: NonNullable<ReturnType<typeof readCredentials>>
): Promise<ResolveBody> {
  try {
    const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
    const res = await fetch(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}/resolve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ argv: process.argv.slice(2) }),
      }
    )
    if (!res.ok) return {}
    return (await res.json()) as ResolveBody
  } catch {
    return {}
  }
}

export async function resolveSessionId(opts: {
  write: boolean
}): Promise<string | undefined> {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) return undefined
  const creds = readCredentials()
  if (!creds) return sessionId
  cached ??= fetchResolution(sessionId, creds)
  const body = await cached
  if (body.resolution === 'ambiguous') {
    if (opts.write) throw new AmbiguousSessionError()
    process.stderr.write(
      'lumo: could not tell which subagent issued this call; using the main session.\n'
    )
    return sessionId
  }
  return typeof body.sessionId === 'string' && body.sessionId
    ? body.sessionId
    : sessionId
}
