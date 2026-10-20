import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const TEAM_DIR = 'team'
const INDEX_FILE = 'MEMORY.md'
/** The full team index (LUM-1288); MEMORY.md's block only points at it. */
const TEAM_INDEX_FILE = 'INDEX.md'

/** A local file the sync owns (carries the `metadata.lumo.source: team` marker). */
export interface OwnedLocalFile {
  id: string
  /** contentHash recorded in the frontmatter = what sync last wrote. */
  contentHash: string
  /** hash of the current on-disk body = detects local edits (drift). */
  diskHash: string
}

function teamPath(root: string): string {
  return join(root, TEAM_DIR)
}

export function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

/**
 * Parse the `lumo: { ... }` ownership marker. Returns null unless the file
 * carries `source: team` — dev-authored files (no marker) are NOT owned and
 * must never be touched by sync.
 */
function parseMarker(text: string): { id: string; contentHash: string } | null {
  const m = text.match(/lumo:\s*\{([^}]*)\}/)
  if (!m || !m[1]) return null
  const inner = m[1]
  if (!/\bsource:\s*team\b/.test(inner)) return null
  const id = inner.match(/\bid:\s*([^,}\s]+)/)?.[1]
  const contentHash = inner.match(/\bcontentHash:\s*([^,}\s]+)/)?.[1]
  if (!id || !contentHash) return null
  return { id, contentHash }
}

/** Body = everything after the closing frontmatter fence, minus the single
 * trailing newline {@link writeEntry} appends (keeps write/read hashing symmetric). */
function bodyOf(text: string): string {
  const end = text.indexOf('\n---\n')
  const raw = end === -1 ? text : text.slice(end + 5)
  return raw.replace(/\n$/, '')
}

/** Read every owned team file under `root/team/`, newest-id order. */
export function readOwned(root: string): OwnedLocalFile[] {
  const dir = teamPath(root)
  if (!existsSync(dir)) return []
  const out: OwnedLocalFile[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const text = readFileSync(join(dir, f), 'utf8')
    const marker = parseMarker(text)
    if (!marker) continue // dev-authored → not owned
    out.push({
      id: marker.id,
      contentHash: marker.contentHash,
      diskHash: hashBody(bodyOf(text)),
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function writeEntry(
  root: string,
  entry: { id: string; frontmatter: string; body: string }
): void {
  const dir = teamPath(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${entry.id}.md`),
    `${entry.frontmatter}\n${entry.body}\n`
  )
}

export function removeEntry(root: string, id: string): void {
  const p = join(teamPath(root), `${id}.md`)
  if (existsSync(p)) rmSync(p)
}

export function readIndex(root: string): string {
  const p = join(root, INDEX_FILE)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

export function writeIndex(root: string, text: string): void {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  writeFileSync(join(root, INDEX_FILE), text)
}

/** Write the full team index to `root/team/INDEX.md` (owned by sync). */
export function writeTeamIndex(root: string, text: string): void {
  const dir = teamPath(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, TEAM_INDEX_FILE), text)
}

/** The current team index file, or null when absent. */
export function readTeamIndex(root: string): string | null {
  const p = join(teamPath(root), TEAM_INDEX_FILE)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/** Remove the team index file, if present (`--clean`). */
export function removeTeamIndex(root: string): void {
  const p = join(teamPath(root), TEAM_INDEX_FILE)
  if (existsSync(p)) rmSync(p)
}
