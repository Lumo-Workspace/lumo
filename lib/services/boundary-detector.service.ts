import type { BoundaryCrossingCategory } from '@prisma/client'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

/**
 * Async forbidden-action boundary detector (LUM-426). Encodes the CLAUDE.md
 * **Forbidden** list as the detection taxonomy (single source) and matches it
 * against already-ingested hook events — observe-only, server-side, AFTER
 * ingestion. It never runs on the CLI hook path (exit-0 invariant, LUM-348):
 * Lumo is the observer here, not the agent runtime, so this is OpenAI
 * auto-review's async half, never a real-time PreToolUse block.
 */

export interface BoundaryDetectionInput {
  taskId: string
  hookEventId?: string | null
  toolName: string | null
  filePath: string | null
  payload: unknown
}

export interface DetectedCrossing {
  category: BoundaryCrossingCategory
  /** Short, human-readable reason — the matched command, or a redacted label
   *  for a secret (the secret value itself is never stored on the marker). */
  detail: string
}

const DETAIL_MAX = 200

function clip(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}…` : t
}

/** Pull the Bash command text out of a PostToolUse payload (unindexed JSON). */
function readCommand(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  const cmd = (input as Record<string, unknown>).command
  return typeof cmd === 'string' ? cmd : null
}

/** Pull written file content (Write `content` / Edit `new_string`) for secret scanning. */
function readWrittenContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const parts = [o.content, o.new_string, o.new_str].filter(
    (v): v is string => typeof v === 'string'
  )
  return parts.length > 0 ? parts.join('\n') : null
}

// --- taxonomy rules (CLAUDE.md Forbidden) -------------------------------------

const PROTECTED_BRANCH = /(?:^|[\s:/])(?:main|master|develop)(?=$|\s)/

/** `git push` aimed at main/develop/master (force or not); feature branches skip. */
function matchProtectedPush(cmd: string): boolean {
  return /\bgit\s+push\b/.test(cmd) && PROTECTED_BRANCH.test(cmd)
}

/** `rm` / `git rm` of anything under prisma/migrations/. */
function matchMigrationDelete(cmd: string): boolean {
  return (
    /(?:^|[\s;&|])(?:rm|git\s+rm)\b/.test(cmd) &&
    /prisma\/migrations\//.test(cmd)
  )
}

/** Irreversible / data-destroying DB commands. */
function matchDestructiveDb(cmd: string): boolean {
  return (
    /prisma\s+migrate\s+reset/.test(cmd) ||
    /\bdb\s+push\b[^\n]*--(?:force-reset|accept-data-loss)/.test(cmd) ||
    /\bdrop\s+(?:database|table)\b/i.test(cmd) ||
    /\btruncate\s+table\b/i.test(cmd)
  )
}

/** Installing a NEW dependency — a bare `npm install` / `npm ci` (restore) is fine. */
function matchNewNpmDependency(cmd: string): boolean {
  // yarn/pnpm/bun add always name a package.
  if (/\b(?:yarn|pnpm|bun)\s+add\b\s+\S/.test(cmd)) return true
  // npm i|install|add — only when a non-flag package token follows the verb.
  const m = cmd.match(/\bnpm\s+(?:i|install|add)\b(.*)$/)
  if (!m) return false
  const rest = m[1] ?? ''
  return rest.split(/\s+/).some(tok => tok.length > 0 && !tok.startsWith('-'))
}

const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/, label: 'API secret key (sk-…)' },
  {
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    label: 'private key block',
  },
]

function matchHardcodedSecret(content: string): string | null {
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(content)) return label
  }
  return null
}

/**
 * Taxonomy-driven reversibility (LUM-435), single source alongside the matchers.
 * Only installing a dependency is reversible (uninstall undoes it). Leaking a
 * secret, force-pushing main, deleting a migration, or a destructive DB command
 * cannot be taken back — those drive a louder remediation nudge on the bar.
 */
export function isReversible(category: BoundaryCrossingCategory): boolean {
  return category === 'NEW_NPM_DEPENDENCY'
}

/**
 * Pure taxonomy match. Returns every boundary the event crosses (a command can
 * trip more than one rule). No I/O — safe to unit-test exhaustively.
 */
export function detectCrossings(
  input: Pick<BoundaryDetectionInput, 'toolName' | 'filePath' | 'payload'>
): DetectedCrossing[] {
  const out: DetectedCrossing[] = []
  const cmd = readCommand(input.payload)
  if (cmd) {
    if (matchProtectedPush(cmd))
      out.push({ category: 'PUSH_TO_PROTECTED_BRANCH', detail: clip(cmd) })
    if (matchMigrationDelete(cmd))
      out.push({ category: 'MIGRATION_FILE_DELETED', detail: clip(cmd) })
    if (matchDestructiveDb(cmd))
      out.push({ category: 'DESTRUCTIVE_DB_COMMAND', detail: clip(cmd) })
    if (matchNewNpmDependency(cmd))
      out.push({ category: 'NEW_NPM_DEPENDENCY', detail: clip(cmd) })
  }

  const content = readWrittenContent(input.payload)
  if (content) {
    const label = matchHardcodedSecret(content)
    if (label)
      out.push({
        category: 'HARDCODED_SECRET',
        // Never echo the secret — store the redacted pattern label + file only.
        detail: clip(`${label} in ${input.filePath ?? 'a written file'}`),
      })
  }

  return out
}

export const boundaryDetectorService = {
  /**
   * Detect forbidden actions on an ingested hook event and, for each match,
   * persist a BoundaryCrossing row + a TaskActivity timeline marker on the
   * bound task. The recording half is ALWAYS on (not gated) — it is pure
   * visibility, free and harmless. Best-effort: it owns its errors and never
   * throws, so a detection failure can never flip the hook response or block
   * the agent (criterion 5 / LUM-348 exit-0 invariant).
   */
  async detectAndRecord(input: BoundaryDetectionInput): Promise<void> {
    try {
      const crossings = detectCrossings(input)
      for (const c of crossings) {
        const row = await boundaryCrossingRepository.create({
          taskId: input.taskId,
          hookEventId: input.hookEventId ?? null,
          category: c.category,
          detail: c.detail,
          reversible: isReversible(c.category),
        })
        await activityRepository.create({
          taskId: input.taskId,
          actorId: null,
          type: 'BOUNDARY_CROSSING_DETECTED',
          payload: {
            boundaryCrossingId: row.id,
            category: c.category,
            detail: c.detail,
            hookEventId: input.hookEventId ?? null,
          },
        })
      }
    } catch (error) {
      // Observe-only: a detector failure must never disrupt ingestion.
      console.error('boundaryDetectorService.detectAndRecord error:', error)
    }
  },
}
