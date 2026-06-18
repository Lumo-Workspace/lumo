import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTBOX_DIR = 'outbox'

/** A locally-authored memory queued for promotion to the team. */
export interface UpsyncCandidate {
  file: string
  category: string
  content: unknown
}

/**
 * Collect upsync candidates from `<root>/outbox/*.json` — each a structured
 * `{ category, content }` the dev authored locally and wants promoted to the
 * team. JSON (not the rendered team/*.md files) keeps the content lossless and
 * already category-shaped; a rendered team file cannot be reversed back to
 * structured content, so edited team files (P1 drift candidates) are reported by
 * `lumo memory sync`, not auto-converted here. Malformed/non-JSON files are
 * skipped, not fatal.
 */
export function collectUpsyncCandidates(root: string): UpsyncCandidate[] {
  const dir = join(root, OUTBOX_DIR)
  if (!existsSync(dir)) return []
  const out: UpsyncCandidate[] = []
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue
    const p = join(dir, f)
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as {
        category?: unknown
        content?: unknown
      }
      if (typeof parsed.category === 'string' && parsed.content !== undefined) {
        out.push({
          file: p,
          category: parsed.category,
          content: parsed.content,
        })
      }
    } catch {
      // skip malformed JSON
    }
  }
  return out
}

/**
 * The endpoint upsync POSTs to. Deliberately the SAME create-project-memory
 * route the web/CLI already use (`createForProject`: canonicalize → dedup →
 * reconcile-on-write, LUM-538) — upsync reuses that pipeline rather than adding
 * a parallel one.
 */
export function projectMemoriesEndpoint(
  base: string,
  projectId: string
): string {
  return `${base}/api/projects/${encodeURIComponent(projectId)}/memories`
}
