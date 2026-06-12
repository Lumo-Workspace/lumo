import type {
  BoundaryCrossingCategory,
  BoundaryCrossingSeverity,
} from '@prisma/client'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { WRITE_TOOLS } from '@/lib/constants/hook-tools'
import { checkpointerFilePaths } from '@/lib/checkpointer/parse'

/**
 * Async forbidden-action boundary detector (LUM-426, extended in LUM-442).
 * Encodes the CLAUDE.md **Forbidden** list plus OpenAI's "rare but high-
 * severity" classes as the detection taxonomy (single source) and matches it
 * against already-ingested hook events — observe-only, server-side, AFTER
 * ingestion. It never runs on the CLI hook path (exit-0 invariant, LUM-348):
 * Lumo is the observer here, not the agent runtime, so this is OpenAI
 * auto-review's async half, never a real-time PreToolUse block.
 *
 * LUM-442 adds three things, all on this one detector + the crossing schema:
 *   1. a SEVERITY tier per crossing (LOW/MEDIUM/HIGH), driving prominence;
 *   2. extended high-severity classes (public exfiltration incl. making a repo
 *      public, cloud-data deletion, infrastructure termination);
 *   3. EVASION awareness — a Bash command is also base64-decoded and re-scanned,
 *      so an obfuscated forbidden command is still caught. This is explicitly
 *      defense-in-depth, not a hard boundary: it runs after the fact and can be
 *      evaded; the bar/docs say so to keep the signal from being over-trusted.
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
  /** Severity tier (LUM-442). HIGH crossings are surfaced most prominently and
   *  force the DONE gate even where the workspace opted out. */
  severity: BoundaryCrossingSeverity
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

// --- LUM-442 extended high-severity taxonomy ----------------------------------
// OpenAI's "rare but high-severity" classes, narrowed to command shapes that
// actually occur in a coding agent's execution context (no cloud-vendor-only
// CLIs that would never fire here). Each is HIGH severity (see severityFor).

/** Exfiltration / upload to the public internet — incl. making a repo public. */
function matchExfiltrationPublic(cmd: string): boolean {
  // Flipping a repository to public visibility.
  if (/\bgh\s+repo\s+(?:edit|create)\b[^\n]*--visibility\s+public/.test(cmd))
    return true
  if (/\bgh\s+repo\s+create\b[^\n]*--public\b/.test(cmd)) return true
  // Uploading a LOCAL file/form to an external http(s) endpoint (the exfil shape
  // is reading local data and POSTing/PUT-ing it out — `@file` / -T / -F file).
  const toHttp = /https?:\/\//.test(cmd)
  if (/\bcurl\b/.test(cmd) && toHttp) {
    if (/(?:-T|--upload-file|-F\s+\S*@|--form\s+\S*@)/.test(cmd)) return true
    if (/--data(?:-binary|-raw|-urlencode)?\s+@/.test(cmd)) return true
  }
  if (/\bwget\b[^\n]*--post-file\b/.test(cmd) && toHttp) return true
  return false
}

/** Deleting cloud-storage data (object stores Lumo's stack can actually touch). */
function matchCloudDataDeletion(cmd: string): boolean {
  return (
    /\baws\s+s3\s+(?:rm|rb)\b/.test(cmd) ||
    /\baws\s+s3api\s+delete-(?:object|objects|bucket)\b/.test(cmd) ||
    /\bgsutil\s+(?:-m\s+)?rm\b/.test(cmd) ||
    /\bgcloud\s+storage\s+rm\b/.test(cmd) ||
    // Vercel Blob — Lumo's actual object store (@vercel/blob).
    /\bvercel\s+blob\s+(?:del|rm|remove)\b/.test(cmd)
  )
}

/** Terminating / restarting infrastructure (kill process, restart cluster). */
function matchInfraTermination(cmd: string): boolean {
  return (
    // kill with a real terminating signal (a bare `kill %1` to free a port is
    // too common/low-signal to flag); pkill/killall are always high-signal.
    /(?:^|[\s;&|])kill\s+-(?:9|KILL|SIGKILL|15|TERM|SIGTERM)\b/.test(cmd) ||
    /(?:^|[\s;&|])(?:pkill|killall)\b/.test(cmd) ||
    /\bsystemctl\s+(?:restart|stop)\b/.test(cmd) ||
    /\bservice\s+\S+\s+(?:restart|stop)\b/.test(cmd) ||
    /\bdocker\s+(?:kill|stop)\b/.test(cmd) ||
    /\bdocker[- ]compose\s+down\b/.test(cmd) ||
    /\bkubectl\s+(?:delete\s+(?:pod|deployment|node|service|namespace)|rollout\s+restart|drain)\b/.test(
      cmd
    ) ||
    /\bpm2\s+(?:restart|stop|delete|kill)\b/.test(cmd)
  )
}

/**
 * Taxonomy-driven reversibility (LUM-435), single source alongside the matchers.
 * Only installing a dependency is reversible (uninstall undoes it). Leaking a
 * secret, force-pushing main, deleting a migration, a destructive DB command,
 * exfiltration, cloud-data deletion, or infra termination cannot be taken back —
 * those drive a louder remediation nudge on the bar.
 */
export function isReversible(category: BoundaryCrossingCategory): boolean {
  return category === 'NEW_NPM_DEPENDENCY'
}

/**
 * Taxonomy-driven severity tier (LUM-442), single source alongside the matchers.
 * HIGH = the "rare but high-severity" classes (secret leak, destructive DB,
 * exfiltration, cloud-data deletion, infra termination). MEDIUM = shared-branch
 * push / migration deletion (serious but recoverable). LOW = a dependency
 * install. Evasion-decoded matches are escalated to HIGH at detection time
 * regardless of the underlying class.
 */
export function severityFor(
  category: BoundaryCrossingCategory
): BoundaryCrossingSeverity {
  switch (category) {
    case 'NEW_NPM_DEPENDENCY':
      return 'LOW'
    case 'PUSH_TO_PROTECTED_BRANCH':
    case 'MIGRATION_FILE_DELETED':
    // Reward-hacking (LUM-441) is serious but ambiguous (a legit test fix looks
    // identical) and high-false-positive, so MEDIUM: visible/tiered, but it
    // honours the workspace opt-out rather than force-gating like a HIGH class.
    case 'TEST_TAMPERING':
      return 'MEDIUM'
    case 'HARDCODED_SECRET':
    case 'DESTRUCTIVE_DB_COMMAND':
    case 'EXFILTRATION_PUBLIC':
    case 'CLOUD_DATA_DELETION':
    case 'INFRA_TERMINATION':
      return 'HIGH'
    default:
      return 'MEDIUM'
  }
}

// --- LUM-442 evasion awareness (base64 decode-and-rescan) ---------------------

const EVASION_MARKER = '[base64-decoded] '
// Bounds to keep decode-and-rescan cheap and DoS-proof (echoes LUM-348's 64k
// truncation philosophy): skip pathological commands, cap how many candidate
// tokens we decode, and cap each token's size.
const EVASION_MAX_CMD = 16_384
const EVASION_MAX_TOKENS = 8
const EVASION_MAX_TOKEN_LEN = 8_192
const BASE64_TOKEN = /[A-Za-z0-9+/]{16,}={0,2}/g
const PRINTABLE_ASCII = /^[\t\n\r\x20-\x7e]+$/

/**
 * Pull plausible decoded shell text out of base64-looking tokens in a command
 * (e.g. `echo <b64> | base64 -d | bash`). Bounded for DoS safety; only returns
 * decodes that look like printable command text, so random base64 of binary
 * (git SHAs, hashes) is discarded rather than flagged.
 */
function decodeBase64Segments(cmd: string): string[] {
  if (cmd.length > EVASION_MAX_CMD) return []
  const tokens = cmd.match(BASE64_TOKEN)
  if (!tokens) return []
  const out: string[] = []
  let scanned = 0
  for (const tok of tokens) {
    if (scanned >= EVASION_MAX_TOKENS) break
    if (tok.length > EVASION_MAX_TOKEN_LEN) continue
    scanned++
    const decoded = Buffer.from(tok, 'base64').toString('utf8')
    if (decoded.length < 4 || decoded.length > EVASION_MAX_TOKEN_LEN) continue
    if (!PRINTABLE_ASCII.test(decoded)) continue
    out.push(decoded)
  }
  return out
}

/** Run the command-shaped matchers and emit a crossing per hit. */
function matchCommand(cmd: string, evasion: boolean): DetectedCrossing[] {
  const out: DetectedCrossing[] = []
  const add = (category: BoundaryCrossingCategory) =>
    out.push({
      category,
      detail: clip(evasion ? `${EVASION_MARKER}${cmd}` : cmd),
      // Evasion is itself OpenAI's highest-frequency class — always HIGH.
      severity: evasion ? 'HIGH' : severityFor(category),
    })
  if (matchProtectedPush(cmd)) add('PUSH_TO_PROTECTED_BRANCH')
  if (matchMigrationDelete(cmd)) add('MIGRATION_FILE_DELETED')
  if (matchDestructiveDb(cmd)) add('DESTRUCTIVE_DB_COMMAND')
  if (matchNewNpmDependency(cmd)) add('NEW_NPM_DEPENDENCY')
  if (matchExfiltrationPublic(cmd)) add('EXFILTRATION_PUBLIC')
  if (matchCloudDataDeletion(cmd)) add('CLOUD_DATA_DELETION')
  if (matchInfraTermination(cmd)) add('INFRA_TERMINATION')
  return out
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
    // 1) Literal scan.
    const literal = matchCommand(cmd, false)
    out.push(...literal)
    // 2) Evasion-aware scan: decode base64-looking tokens and re-run the same
    //    matchers. Only surface a category the literal pass missed — so an
    //    obfuscated forbidden command is still flagged (headline case) without
    //    double-counting a command that's already plainly visible.
    const seen = new Set(literal.map(c => c.category))
    for (const decoded of decodeBase64Segments(cmd)) {
      for (const m of matchCommand(decoded, true)) {
        if (seen.has(m.category)) continue
        seen.add(m.category)
        out.push(m)
      }
    }
  }

  const content = readWrittenContent(input.payload)
  if (content) {
    const label = matchHardcodedSecret(content)
    if (label)
      out.push({
        category: 'HARDCODED_SECRET',
        // Never echo the secret — store the redacted pattern label + file only.
        detail: clip(`${label} in ${input.filePath ?? 'a written file'}`),
        severity: severityFor('HARDCODED_SECRET'),
      })
  }

  return out
}

// --- reward-hacking: test-tampering (LUM-441) --------------------------------

/** The slice of a MACHINE acceptance criterion the tampering check needs. */
export interface MachineCheckpointer {
  criterionId?: string | undefined
  /** The criterion's statement — surfaced on the flag so a reviewer sees which
   *  check the edited file backs (criterion 4, the HUMAN read). */
  statement?: string | undefined
  /** The checkpointer command string (its file paths are what an edit may hit). */
  checkpointer: string
}

/** Normalize a path for cross-form comparison (absolute event vs repo-relative
 *  checkpointer arg): forward slashes, no leading `./`. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Does an Edit/Write event's file path refer to the same file as a
 * checkpointer's path arg? The event path is typically absolute
 * (`/…/repo/__tests__/foo.test.ts`) and the checkpointer's is repo-relative
 * (`__tests__/foo.test.ts`); match on a path-segment boundary so a relative ref
 * matches the tail of the absolute event without `foo.test.ts` matching
 * `barfoo.test.ts`.
 */
export function eventPathMatchesCheckpointerPath(
  eventPath: string,
  refPath: string
): boolean {
  const e = normalizePath(eventPath)
  const r = normalizePath(refPath)
  if (!e || !r) return false
  return e === r || e.endsWith(`/${r}`) || r.endsWith(`/${e}`)
}

/**
 * Reward-hacking detector (LUM-441, OpenAI misalignment taxonomy). An agent that
 * edits the very test file a MACHINE acceptance checkpointer runs may be fixing
 * the underlying code — or weakening the test to force a fake PASS. We can't tell
 * statically, so this is a flag-for-review (not a hard block): if an Edit/Write
 * event's file is referenced by any of the bound task's MACHINE checkpointers,
 * record ONE TEST_TAMPERING crossing naming the file + the criterion that
 * depends on it. A human dispositions it FALSE_POSITIVE (legit test fix) or
 * CONFIRMED (LUM-435). Pure — the criteria are passed in, no I/O.
 */
export function detectTestTampering(input: {
  toolName: string | null
  filePath: string | null
  machineCheckpointers: MachineCheckpointer[]
}): DetectedCrossing | null {
  if (!input.filePath) return null
  if (!input.toolName || !WRITE_TOOLS.includes(input.toolName)) return null
  for (const mc of input.machineCheckpointers) {
    const hit = checkpointerFilePaths(mc.checkpointer).find(p =>
      eventPathMatchesCheckpointerPath(input.filePath as string, p)
    )
    if (hit) {
      const because = mc.statement
        ? ` — a MACHINE check depends on it ("${mc.statement}")`
        : ' — a MACHINE check depends on it'
      return {
        category: 'TEST_TAMPERING',
        detail: clip(`edited ${hit}${because}`),
        severity: severityFor('TEST_TAMPERING'),
      }
    }
  }
  return null
}

/**
 * Load the bound task's MACHINE checkpointers and run the pure tampering check
 * (LUM-441). Gated up front: only an Edit/Write event carrying a file path can
 * tamper with a test, so a Bash/Read/Stop event short-circuits BEFORE any DB
 * read — the criteria query is paid only on the events that can match.
 */
async function detectTestTamperingForTask(
  input: BoundaryDetectionInput
): Promise<DetectedCrossing | null> {
  if (!input.filePath) return null
  if (!input.toolName || !WRITE_TOOLS.includes(input.toolName)) return null
  const criteria = await acceptanceCriterionRepository.listByTask(input.taskId)
  const machineCheckpointers: MachineCheckpointer[] = criteria
    .filter(c => c.verifierType === 'MACHINE' && !!c.checkpointer)
    .map(c => ({
      criterionId: c.id,
      statement: c.statement,
      checkpointer: c.checkpointer as string,
    }))
  if (machineCheckpointers.length === 0) return null
  return detectTestTampering({
    toolName: input.toolName,
    filePath: input.filePath,
    machineCheckpointers,
  })
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
      const tampering = await detectTestTamperingForTask(input)
      if (tampering) crossings.push(tampering)
      for (const c of crossings) {
        const row = await boundaryCrossingRepository.create({
          taskId: input.taskId,
          hookEventId: input.hookEventId ?? null,
          category: c.category,
          detail: c.detail,
          reversible: isReversible(c.category),
          severity: c.severity,
        })
        await activityRepository.create({
          taskId: input.taskId,
          actorId: null,
          type: 'BOUNDARY_CROSSING_DETECTED',
          payload: {
            boundaryCrossingId: row.id,
            category: c.category,
            detail: c.detail,
            severity: c.severity,
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
