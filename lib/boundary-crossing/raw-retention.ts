/**
 * LUM-912 — how long a dispositioned boundary crossing keeps its raw text.
 * Pure (no Prisma, no I/O): the sweep, the settings API and the settings row
 * share one definition.
 *
 * A crossing is "used up" once it is dispositioned (a human ruling, or the
 * system's AUTO_SUPPRESSED / AUTO_LEGIT): nothing left to decide reads the
 * raw command, diff line or explanation. `retentionDays` after that, the raw
 * fields are replaced by a code-free description and a hash.
 */
import { createHash } from 'crypto'

/** OWNER-selectable tiers, in days after the disposition. */
export const CROSSING_RAW_RETENTION_DAYS = [7, 30, 90] as const

export type CrossingRawRetentionDays =
  (typeof CROSSING_RAW_RETENTION_DAYS)[number]

export const DEFAULT_CROSSING_RAW_RETENTION_DAYS: CrossingRawRetentionDays = 7

export function isCrossingRawRetentionDays(
  value: unknown
): value is CrossingRawRetentionDays {
  return (CROSSING_RAW_RETENTION_DAYS as readonly unknown[]).includes(value)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Crossings dispositioned at or before this instant are due. Out-of-tier values read as the default. */
export function crossingRawPurgeCutoff(now: Date, retentionDays: number): Date {
  const days = isCrossingRawRetentionDays(retentionDays)
    ? retentionDays
    : DEFAULT_CROSSING_RAW_RETENTION_DAYS
  return new Date(now.getTime() - days * DAY_MS)
}

/**
 * LUM-933: the workspace's `crossingRawRetentionSince` after the OWNER moves
 * the window from `fromDays` to `toDays` at `now`. A shorter window only
 * applies to crossings dispositioned from now on — the ones ruled before
 * keep the longer promise (and are never purged automatically, like the
 * pre-rollout stock). A longer or equal window leaves the cutoff alone.
 */
export function nextCrossingRawRetentionSince(input: {
  fromDays: number
  toDays: number
  since: Date
  now: Date
}): Date {
  const from = isCrossingRawRetentionDays(input.fromDays)
    ? input.fromDays
    : DEFAULT_CROSSING_RAW_RETENTION_DAYS
  return input.toDays < from ? input.now : input.since
}

/** Prefix of a purged target, so a reader can tell a hash from a real target. */
export const PURGED_TARGET_PREFIX = 'sha256:'

/** The target a purged crossing keeps: a short, stable hash. */
export function hashCrossingTarget(target: string | null): string | null {
  if (target == null) return null
  if (target.startsWith(PURGED_TARGET_PREFIX)) return target
  const digest = createHash('sha256').update(target).digest('hex')
  return `${PURGED_TARGET_PREFIX}${digest.slice(0, 32)}`
}

/** Tools whose first argument names the action (`git push`, `npm install`). */
const TWO_WORD_TOOLS = new Set([
  'git',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'gh',
  'docker',
  'kubectl',
  'aws',
  'gcloud',
  'gsutil',
  'az',
  'vercel',
  'prisma',
  'lumo',
  'terraform',
])

const PATH_LIKE = /^[\w@~./:-]+$/
const VERB_LIKE = /^[a-z][a-z0-9-]*$/

/** Leading `VAR=value` assignments and `sudo` are not the action. */
function significantTokens(command: string): string[] {
  const tokens = command.trim().split(/\s+/)
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!
    if (t === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) i++
    else break
  }
  return tokens.slice(i)
}

function basename(token: string): string {
  const parts = token.split('/')
  return parts[parts.length - 1] ?? token
}

/**
 * The command's verb without its arguments: `psql`, `git push`, `aws s3`.
 * Null when the first word does not look like a program name.
 */
export function commandVerbOf(command: string): string | null {
  const [first, second] = significantTokens(command)
  if (!first) return null
  const program = basename(first)
  if (!VERB_LIKE.test(program)) return null
  if (TWO_WORD_TOOLS.has(program) && second && VERB_LIKE.test(second)) {
    return `${program} ${second}`
  }
  return program
}

/**
 * What a purged crossing's `detail` becomes: its category and, when the
 * target is a file path, the path; when it is a command, the command's verb.
 * Never any of the command's arguments, diff text or file content.
 */
export function describeCrossingWithoutCode(input: {
  category: string
  target: string | null
}): string {
  const { category, target } = input
  const t = target?.trim()
  if (!t || t.startsWith(PURGED_TARGET_PREFIX)) return category
  if (!/\s/.test(t) && PATH_LIKE.test(t) && t.length <= 300) {
    return `${category} · ${t}`
  }
  const verb = commandVerbOf(t)
  return verb ? `${category} · $ ${verb} …` : category
}

/** Activity payload keys that may quote the raw command, diff or explanation. */
const RAW_ACTIVITY_KEYS = ['detail', 'evidence'] as const

/** Marker a scrubbed activity payload carries. */
export const RAW_PURGED_ACTIVITY_KEY = 'rawPurged'

/**
 * A crossing's TaskActivity payload with its raw copies replaced: `detail`
 * becomes the same code-free description the crossing keeps, `evidence`
 * (re-judge) is dropped. Everything else (ids, category, from/to, the
 * human's disposition note) is kept.
 */
export function scrubCrossingActivityPayload(
  payload: unknown,
  description: string
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const source = payload as Record<string, unknown>
  if (source[RAW_PURGED_ACTIVITY_KEY] === true) return null
  if (!RAW_ACTIVITY_KEYS.some(k => k in source)) return null
  const out: Record<string, unknown> = { ...source }
  if ('detail' in out) out.detail = description
  delete out.evidence
  out[RAW_PURGED_ACTIVITY_KEY] = true
  return out
}
