import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface LocalTranscript {
  sessionId: string
  path: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * LUM-932: list main session transcripts under
 * `$CLAUDE_CONFIG_DIR/projects/<project>/<sessionId>.jsonl` (default
 * `~/.claude`). Names that are not a UUID are skipped. Never throws.
 */
export function listTranscripts(): LocalTranscript[] {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const root = join(base, 'projects')
  if (!existsSync(root)) return []
  const out: LocalTranscript[] = []
  const seen = new Set<string>()
  try {
    for (const proj of readdirSync(root, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue
      const dir = join(root, proj.name)
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue
        const sessionId = f.slice(0, -'.jsonl'.length)
        if (!UUID_RE.test(sessionId)) continue
        if (seen.has(sessionId)) continue
        const path = join(dir, f)
        try {
          if (!statSync(path).isFile()) continue
        } catch {
          continue
        }
        seen.add(sessionId)
        out.push({ sessionId, path })
      }
    }
  } catch {
    // unreadable directory: return what we have
  }
  return out
}
