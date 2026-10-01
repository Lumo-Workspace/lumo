import type {
  BoundaryCrossingCategory,
  BoundaryCrossingSeverity,
} from '@prisma/client'
import { createHash } from 'crypto'
// LUM-779: single-sourced with the CLI's local-git probe — see the module doc.
import { TEST_FILE_TARGET } from '../../shared/src/test-file-path'
import {
  CHECKOUT_RELATIVE_PATH_FIELD,
  WRITTEN_PATH_IGNORED_FIELD,
  WRITTEN_PATH_PROBE_FIELD,
  WRITTEN_PATH_PROBE_FILE_DIR,
} from '../../shared/src/written-path-probe'
import { hasRedactedContent } from '@/lib/hook-payload/redact'
import {
  isCrossingAdvisoryRule,
  isShapeRule,
  redactForStorage,
  scanSecrets,
  type RawSecretFinding,
  type SecuritySeverity,
} from '@/lib/security-scan'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { WRITE_TOOLS } from '@/lib/constants/hook-tools'
import { checkpointerFilePaths } from '@/lib/checkpointer/parse'
import {
  classifyTestTampering,
  type JudgeInput,
  type JudgeVerdict,
  type TamperingJudge,
} from '@/lib/boundary-crossing/test-tampering-judge'
import {
  confirmActionCrossing,
  isActionConfirmCategory,
  stripHeredocBodies,
  stripProse,
  type ActionConfirmInput,
  type ActionConfirmJudge,
  type ActionConfirmVerdict,
} from '@/lib/boundary-crossing/action-confirm'
import { matchPathGlob } from '@/lib/services/policy/predicate-eval'
import type { PolicyRule } from '@/lib/services/policy/types'
import {
  splitCommandSegments as splitCommandSegmentsShared,
  executingSegments,
} from '@/lib/boundary-crossing/command-shape'
import { matchActionRule } from '@/lib/boundary-crossing/action-rule-match'
import { matchPushTarget } from '@/lib/boundary-crossing/push-target-match'
import {
  EVASION_MARKER,
  isEvasionDecoded,
} from '@/lib/boundary-crossing/evasion'
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import {
  findSuppressionRule,
  autoSuppressedNote,
  type ActiveSuppressionRule,
} from '@/lib/boundary-crossing/suppression'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
// NOTE: both LLM clients (`@/lib/llm/test-tampering-judge-client` and
// `@/lib/llm/action-confirm-client`) are loaded LAZILY inside their cached
// wrappers — they pull in the heavy `ai` / `@ai-sdk/gateway` SDK, and a static
// import would drag that into every module that imports this detector (and every
// test of it). Deferring the import keeps the cost on the one path that actually
// calls the model (the ambiguous residual / the prose candidate).

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
  /** Coalescing target (LUM-477): the specific thing this crossing is about — the
   *  edited file for TEST_TAMPERING/secret, the normalized command for action
   *  classes. Repeated detections with the same (taskId, category, target) merge
   *  into one OPEN crossing instead of recording a duplicate per event. Never the
   *  secret VALUE — a secret's target is its file, so it stays redacted. */
  target: string
  /** LUM-478: set ONLY on a TEST_TAMPERING crossing the DETERMINISTIC pre-filter
   *  judged high-confidence legit (production code co-changed AND assertions
   *  intact). The recorder auto-resolves it with the system AUTO_LEGIT disposition
   *  — on record + auditable, but out of the open queue and non-DONE-blocking.
   *  Never set for a judge-only (LLM) legit verdict, which stays a
   *  human-dispositioned LOW crossing: the LLM is not trusted to auto-clear the
   *  gate (the narrow, deterministic-only softening). */
  autoResolve?: boolean
  /** LUM-590: advisory crossings come from project-specific predicates — surfaced
   *  in the panel but never block the DONE gate. A mapped built-in produces a
   *  blocking crossing; a project-specific predicate produces advisory in v1. */
  advisory?: boolean
  /** LUM-590: stable id of the compiled PolicyRule that fired this crossing. */
  policyRuleRef?: string
  /** LUM-590: frozen verbatim text of the policy rule at detection time. */
  policyRuleText?: string
}

const DETAIL_MAX = 200

/**
 * The stored form of a crossing's `detail` / `target`. LUM-900: both are built
 * from the raw command, so credentials in it are redacted (storage form,
 * `ghp_…(len 40)`) BEFORE the cap — clipping first could cut a secret into a
 * fragment no registry rule recognises any more.
 */
function clip(s: string): string {
  const t = redactForStorage(s).text.trim().replace(/\s+/g, ' ')
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}…` : t
}

/** Was this stored `detail` produced by `clip` truncating the command? A
 *  clipped detail is not the whole command, so nothing may be re-judged from
 *  it alone (LUM-772 backfill). LUM-904: judged on the trailing `…` alone —
 *  the LUM-898 re-redaction shortens a clipped detail that quoted a credential
 *  (201 → 174), so its length says nothing any more. A whole command that
 *  happens to end in `…` reads as clipped too and stays open for a human, the
 *  safe side. */
export function isClippedDetail(detail: string): boolean {
  return detail.endsWith('…')
}

/** Pull the Bash command text out of a PostToolUse payload (unindexed JSON). */
function readCommand(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  const cmd = (input as Record<string, unknown>).command
  return typeof cmd === 'string' ? cmd : null
}

/**
 * LUM-779: the CLI post-tool-use hook folds `_lumo_deleted_test_files` into a
 * Bash payload whose command looked like a delete — the tracked test files that
 * are ACTUALLY missing after the command ran (working tree + index vs HEAD, and
 * commits not on the base branch). Three states, and the difference between
 * the last two is the whole point:
 *   - string[] (maybe empty) → the probe ran; this is the verdict
 *   - null                   → no field / malformed → the probe did not run
 * A malformed field reads as absent so a broken client can never downgrade.
 */
export const DELETED_TEST_FILES_FIELD = '_lumo_deleted_test_files'

export function readDeletedTestFiles(payload: unknown): string[] | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>)[DELETED_TEST_FILES_FIELD]
  if (!Array.isArray(raw)) return null
  if (!raw.every(v => typeof v === 'string')) return null
  return raw as string[]
}

/**
 * Pull written file content (Write `content` / Edit `new_string` / MultiEdit
 * `edits[].new_string` / NotebookEdit `new_source`, LUM-904) for secret
 * scanning.
 */
function readWrittenContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const edits = Array.isArray(o.edits)
    ? o.edits.map(e =>
        e && typeof e === 'object'
          ? (e as Record<string, unknown>).new_string
          : undefined
      )
    : []
  const parts = [
    o.content,
    o.new_string,
    o.new_str,
    o.new_source,
    ...edits,
  ].filter((v): v is string => typeof v === 'string')
  return parts.length > 0 ? parts.join('\n') : null
}

// --- taxonomy rules (CLAUDE.md Forbidden) -------------------------------------

const PROTECTED_BRANCH = /(?:^|[\s:/])(?:main|master|develop)(?=$|\s)/

/**
 * Split a compound command into its top-level invocation segments on the shell
 * separators (`;`, `&&`, `||`, `|`, newline). Quote-/subshell-aware splitting is
 * deliberately out of scope — "good enough", and a missed split only ever leaves
 * MORE text in a push segment, erring toward flagging (the conservative side).
 */
function splitCommandSegments(cmd: string): string[] {
  return splitCommandSegmentsShared(cmd)
}

/**
 * `git push` aimed at a protected branch (main/master/develop), force or not.
 *
 * LUM-464: scoped to the push invocation's OWN target, not the whole command
 * string. A protected name that merely appears in a sibling sub-command (e.g.
 * the `git merge-base origin/main HEAD` / `git diff origin/main..HEAD` that
 * worktree review routinely runs) no longer false-positives a push that
 * actually targets a feature branch. We split the command on shell separators,
 * keep only segment(s) that invoke `git push`, and test the protected pattern
 * against just the args AFTER `git push` (the target/refspec) — so the source
 * side of a `main:feature` refspec is correctly ignored while `HEAD:master` and
 * `origin develop` still match.
 *
 * A bare `git push` with no explicit target is NOT flagged: the target is
 * unknowable from the command alone, and this detector is defense-in-depth, so
 * dropping that rare case lowers false positives (per the task's stated tradeoff).
 */
function matchProtectedPush(cmd: string): boolean {
  for (const seg of splitCommandSegments(cmd)) {
    if (!/\bgit\s+push\b/.test(seg)) continue
    const target = seg.replace(/^[\s\S]*?\bgit\s+push\b/, '')
    if (PROTECTED_BRANCH.test(target)) return true
  }
  return false
}

/** A `.worktrees/` path segment marks a throwaway git-worktree checkout — a
 *  per-worktree copy of prisma/migrations/, NOT the canonical tracked repo
 *  migrations the CLAUDE.md red line protects (LUM-482). */
const WORKTREE_PATH_SEGMENT = /(?:^|\/)\.worktrees\//

/**
 * `rm` / `git rm` of a CANONICAL repo migration under prisma/migrations/.
 *
 * LUM-482: a deletion confined to a git worktree checkout
 * (`.worktrees/<name>/prisma/migrations/…`) is NOT a canonical-migration delete —
 * those checkouts are throwaway, so removing one (e.g. after a detached
 * prod-migrate run) used to false-trip this MEDIUM crossing. We flag only when at
 * least one `rm`/`git rm` target references `prisma/migrations/` OUTSIDE a
 * `.worktrees/` segment, so a real repo migration delete (`rm prisma/migrations/…`,
 * relative or absolute to the main checkout) is unchanged while a worktree cleanup
 * no longer trips. A command that deletes BOTH a real migration and a worktree
 * copy still flags on the real one (the conservative direction).
 *
 * LUM-511: scoped to the rm invocation's OWN segment, not the whole command line
 * — mirroring `matchProtectedPush`. The old check tested for an `rm`/`git rm`
 * token ANYWHERE and a `prisma/migrations/` token ANYWHERE, independently, so a
 * command that deletes an unrelated temp file (`rm -f checkcol.ts`) while a
 * SIBLING command merely *applies* a migration (`prisma db execute --file
 * prisma/migrations/…`) or *checks* for one (`git ls-tree | grep
 * prisma/migrations/…`) false-tripped. We now split on shell separators, keep
 * only segment(s) that invoke `rm`/`git rm`, and require the migration path to
 * appear in that segment's args AFTER the rm verb — the path must actually be a
 * delete target, not just co-occur elsewhere in the line.
 */
function matchMigrationDelete(cmd: string): boolean {
  for (const seg of splitCommandSegments(cmd)) {
    const m = seg.match(/(?:^|[\s(])(?:rm|git\s+rm)\b/)
    if (!m) continue
    const args = seg.slice((m.index ?? 0) + m[0].length)
    const deletesMigration = args
      .split(/\s+/)
      .some(
        tok =>
          tok.includes('prisma/migrations/') && !WORKTREE_PATH_SEGMENT.test(tok)
      )
    if (deletesMigration) return true
  }
  return false
}

/** Tool-specific irreversibles — fire on any executing segment. */
const DB_TOOL_RESET =
  /prisma\s+migrate\s+reset|\bdb\s+push\b[^\n]*--(?:force-reset|accept-data-loss)/
/** Generic SQL drop/truncate phrases. */
const DB_DDL_PHRASE = /\bdrop\s+(?:database|table)\b|\btruncate\s+table\b/i

/**
 * Irreversible / data-destroying DB commands. LUM-751: segment-scoped and
 * print/search-aware — only EXECUTING segments (see
 * lib/boundary-crossing/command-shape) are tested, so a `grep` / `echo` /
 * `git log --grep` naming DDL, the same grep inside a `bash -c '…'` wrapper, or
 * a PR body / commit message never trips it, while `psql -c "…"`,
 * `mysql -e "…"` and `prisma migrate reset` still do. (Re-instates the LUM-426
 * print-or-search exclusion that the prose gate had absorbed, deterministic
 * this time — no LLM round-trip for the obvious shapes.)
 */
function matchDestructiveDb(cmd: string): boolean {
  return executingSegments(cmd).some(
    seg => DB_TOOL_RESET.test(seg) || DB_DDL_PHRASE.test(seg)
  )
}

/**
 * Installing a NEW dependency — only a segment whose OWN `npm i|install|add`
 * (or `yarn|pnpm|bun add`) names a package. LUM-751: segment-scoped, so
 * `npm install && npm test`, a lockfile sync inside `.worktrees/`, a flag-only
 * install and `npm ci` never trip; a trailing `# comment` is ignored. (A
 * lockfile-diff check is the PR scanner's job — LUM-738 — the hook only sees
 * the command.)
 */
function matchNewNpmDependency(cmd: string): boolean {
  // LUM-770: a heredoc body is authored text (a script or doc being written),
  // not an install. LUM-772: the body now rides with the segment that opens it
  // (`cat > f <<EOF` is dropped whole as a read-only carrier), and is stripped
  // from any executing segment that still carries one, so `'npm install x'`
  // inside a probe script never trips the rule. NEW_NPM_DEPENDENCY never
  // reaches the LUM-466 prose confirmation, so this is the only place the
  // body can be excluded.
  for (const raw of executingSegments(cmd)) {
    const seg = stripHeredocBodies(raw).split('#')[0] ?? ''
    if (/\b(?:yarn|pnpm|bun)\s+add\s+\S/.test(seg)) return true
    const m = seg.match(/\bnpm\s+(?:i|install|add)\b(.*)$/)
    if (!m) continue
    const rest = m[1] ?? ''
    if (rest.split(/\s+/).some(tok => tok.length > 0 && !tok.startsWith('-')))
      return true
  }
  return false
}

// --- hardcoded secrets: single source with the PR scanner (LUM-734) ----------
// The session-side detector and the PR security scan (LUM-732) must agree on
// what a secret looks like, so the detector owns NO regex of its own: it runs
// the same pure `scanSecrets` over the written content — same registry
// (`lib/security-scan/secret-patterns`), same highest-severity / first-wins
// reporting rule, same placeholder-value and test/fixture/doc-path downgrade
// rules. The crossing keeps strictly LESS than the scan finding: the pattern
// title + the written file. The scanner's (already redacted) evidence line is
// deliberately not copied onto the crossing.

const UNKNOWN_WRITTEN_FILE = 'a written file'

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
}

/**
 * LUM-893: a hit that is recorded but never blocks DONE on its own — a
 * downgraded hit (placeholder / test-fixture-doc path) or a rule the registry
 * marks advisory for crossings (the broad LUM-887 shapes, test-mode keys).
 */
function isAdvisorySecretHit(f: RawSecretFinding): boolean {
  return f.downgrade != null || isCrossingAdvisoryRule(f.ruleId)
}

/**
 * One write → at most one finding. A blocking hit always beats an advisory one
 * (LUM-893 — a broad-shape line must never mask a real key elsewhere in the
 * same write); within that, the highest severity, first among ties
 * (`scanSecrets` walks the registry in order, so a tie resolves to the more
 * specific pattern, exactly as in a PR scan). `filePath` feeds the
 * path-downgrade rule; a Write with no path is treated as a production path
 * (never downgraded on a guess).
 */
function scanWrittenContent(
  content: string,
  filePath: string | null
): RawSecretFinding | null {
  const lines = content.split('\n').map((text, i) => ({ lineNo: i + 1, text }))
  const findings = scanSecrets([{ path: filePath ?? '', lines }])
  const rank = (f: RawSecretFinding) =>
    (isAdvisorySecretHit(f) ? 0 : 10) + SEVERITY_RANK[f.severity]
  let best: RawSecretFinding | null = null
  for (const f of findings) {
    if (!best || rank(f) > rank(best)) best = f
  }
  return best
}

const ABSOLUTE_PATH = /^(?:[A-Za-z]:)?[\\/]/

/**
 * LUM-904: `/` separators with `.` / `..` segments collapsed, so
 * `/repo/../docs/x.ts` is judged as the `/docs/x.ts` it really is. A relative
 * path whose `..` climbs above its start keeps the leading `..` segments.
 */
function normalizeSegments(p: string): string {
  const s = p.replace(/\\/g, '/')
  const drive = /^[A-Za-z]:/.exec(s)?.[0] ?? ''
  const rest = s.slice(drive.length)
  const absolute = rest.startsWith('/')
  const out: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop()
    } else if (seg === '..' && absolute) {
      continue
    } else {
      out.push(seg)
    }
  }
  return drive + (absolute ? '/' : '') + out.join('/')
}

/**
 * LUM-904: the CLI post-tool-use hook folds `CHECKOUT_RELATIVE_PATH_FIELD`
 * into a write payload — local git's answer to "where is this file inside its
 * own checkout?" (`git rev-parse --show-prefix` run beside the file). It is
 * the only reliable root: a session started in a parent directory
 * (`cwd=/Users/me`, file `/Users/me/docs/app/lib/x.ts`) would otherwise make
 * the checkout's own location read as a doc/test path.
 */
export { CHECKOUT_RELATIVE_PATH_FIELD }

/**
 * The reported checkout-relative path, only when it can be the written file:
 * relative, no `..`, and the (normalized) written path ends with it on a
 * segment boundary. Anything else reads as "no answer" — a malformed or
 * mismatched field can never steer the path downgrade.
 */
function readCheckoutRelativePath(
  payload: unknown,
  file: string
): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>)[CHECKOUT_RELATIVE_PATH_FIELD]
  if (typeof raw !== 'string' || raw === '' || ABSOLUTE_PATH.test(raw))
    return null
  const rel = normalizeSegments(raw)
  if (rel === '' || rel.split('/').includes('..')) return null
  return `/${file}`.endsWith(`/${rel}`) ? rel : null
}

/**
 * LUM-899: the path the test/fixture/doc downgrade is judged on — relative to
 * the checkout, so a checkout living under `~/docs/` or `/ci/tests/` is not
 * mistaken for a doc/test path. LUM-904: the CLI-reported checkout-relative
 * path wins; without it, the hook's `cwd` is the root (an older client — a
 * session started above the checkout still reads the checkout's location as
 * part of the path). Both sides are `..`-normalized first. A path outside the
 * known checkout gets no path downgrade (`''`) rather than a guess.
 */
function checkoutRelativePath(
  filePath: string | null,
  payload: unknown
): string | null {
  if (filePath == null) return null
  const file = normalizeSegments(filePath)
  const reported = readCheckoutRelativePath(payload, file)
  if (reported != null) return reported
  if (!ABSOLUTE_PATH.test(filePath)) {
    return file.split('/').includes('..') ? '' : file
  }
  const cwd =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).cwd
      : undefined
  if (typeof cwd === 'string' && ABSOLUTE_PATH.test(cwd)) {
    const root = normalizeSegments(cwd).replace(/\/+$/, '') + '/'
    if (file.startsWith(root)) return file.slice(root.length)
  }
  return ''
}

/**
 * LUM-893: local env files that frameworks keep out of git by convention
 * (`.env.local`, `.env.<mode>.local`, `.env.test`). LUM-899: only a guess —
 * `.env.test` is often committed and a `.env.local` can be tracked — so it is
 * used only when the hook's git probe gave no answer, and only downgrades a
 * broad-shape rule, never a vendor-prefixed key.
 */
const LOCAL_ENV_FILE =
  /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?\.local$|(?:^|[\\/])\.env\.test$/

export function isLocalEnvFile(filePath: string | null): boolean {
  return filePath != null && LOCAL_ENV_FILE.test(filePath)
}

/**
 * LUM-893: the CLI post-tool-use hook folds `_lumo_written_path_ignored` into a
 * Write/Edit payload — local git's answer to "is this file gitignored?". Only a
 * boolean counts; a missing or malformed field reads as "unknown" so a broken
 * or old client can never downgrade a crossing.
 */
export { WRITTEN_PATH_IGNORED_FIELD, WRITTEN_PATH_PROBE_FIELD }

export function readWrittenPathIgnored(payload: unknown): boolean | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as Record<string, unknown>)[WRITTEN_PATH_IGNORED_FIELD]
  return typeof raw === 'boolean' ? raw : null
}

/**
 * LUM-908: the CLI (1.80.2+) folds a marker next to the answer saying the
 * probe ran in the checkout the written file lives in (LUM-903's fix). Only
 * the exact value counts; anything else reads as an unmarked (old) answer.
 */
function hasFileDirProbeMarker(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const raw = (payload as Record<string, unknown>)[WRITTEN_PATH_PROBE_FIELD]
  return raw === WRITTEN_PATH_PROBE_FILE_DIR
}

/**
 * LUM-903: CLI 1.80.0 probed from the session cwd, so a session in the main
 * checkout writing into `.worktrees/<task>/` got "ignored" for every tracked
 * file (the main `.gitignore` hides `.worktrees/`). Installed clients keep
 * sending that wrong `true` until they upgrade, so a `true` for a path under a
 * `.worktrees/` directory is not trusted — the hit is judged as if no probe
 * answered. LUM-908: unless the payload carries the file-dir probe marker,
 * which only a fixed client sends.
 */
const WORKTREES_SEGMENT = /(?:^|[\\/])\.worktrees[\\/]/

export function trustedWrittenPathIgnored(
  payload: unknown,
  filePath: string | null
): boolean | null {
  const ignored = readWrittenPathIgnored(payload)
  if (
    ignored === true &&
    filePath != null &&
    WORKTREES_SEGMENT.test(filePath) &&
    !hasFileDirProbeMarker(payload)
  )
    return null
  return ignored
}

function secretDowngradeSuffix(
  f: RawSecretFinding,
  file: { local: boolean; ignored: boolean }
): string {
  switch (f.downgrade) {
    case 'PLACEHOLDER_VALUE':
      return ' (placeholder value — downgraded, advisory)'
    case 'DOWNGRADED_PATH':
      return ' (test/fixture/doc path — downgraded, advisory)'
  }
  if (file.ignored) return ' (gitignored file — advisory)'
  if (file.local) return ' (local env file — advisory)'
  if (isShapeRule(f.ruleId)) return ' (broad credential shape — advisory)'
  if (isCrossingAdvisoryRule(f.ruleId)) return ' (test-mode key — advisory)'
  return ''
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

// --- LUM-736 L4 Session Guard: deterministic, no-LLM session classes ----------
// All three ride the existing chain (detectAndRecord → coalesce → human-only
// disposition → crossing explain → DONE gate) and write NO finding row. Each is
// MEDIUM + reversible. The two command classes are segment-scoped and go through
// the LUM-466 prose confirmation (stripProse → LLM only on a prose-only
// candidate) so a commit message / PR body quoting the flag never self-trips
// (the LUM-640/722 lesson).

const HUSKY_OFF = /(?:^|\s)HUSKY=0(?=\s|$)/
/** `-n` alone or folded into a combined short-flag token (`-nm`, `-an`, `-anm`).
 *  Token-level on purpose: a `-n"` glued to a closing quote is message text. */
const COMMIT_SHORT_NO_VERIFY = /^-[a-z]*n[a-z]*$/
/** `core.hooksPath=<anything>` — pointing the hooks dir elsewhere (typically
 *  `/dev/null` or an empty dir) disables husky just like `--no-verify`. Git
 *  config keys are case-insensitive. */
const HOOKS_PATH_OVERRIDE = /core\.hookspath=/i
/** The git binary as a shell token — bare, path-prefixed, opening a subshell,
 *  or opening a shell-wrapper string (`bash -c "git …"`, `sh -c 'git …'`,
 *  `$'git …'`). Group 1 captures that opening quote so the wrapped command can
 *  be closed at the matching quote (LUM-744 follow-up: the LUM-736 `\bgit`
 *  regex saw through the quote; the token parser must too). */
const GIT_BINARY_TOKEN = /^(?:\$?\()?(?:\$?(['"]))?(?:\S*\/)?git$/
/** Git GLOBAL options that consume the NEXT token as their value, so that value
 *  is never mistaken for the subcommand (`git -C commit commit` …). The `=` /
 *  folded forms (`--git-dir=x`, `-cKEY=VAL`) are single tokens and need no entry. */
const GIT_GLOBAL_OPTS_WITH_VALUE = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
  '--config-env',
  '--attr-source',
])

/**
 * Bypassing local git hooks (LUM-736; short-flag + hooksPath forms LUM-744):
 * a segment that runs `git commit` / `git push` with `--no-verify` after the
 * verb, `git commit` with the `-n` short flag (`-n`, `-nm`, `-an` … — commit
 * only: on `push`, `-n` is `--dry-run`), or any `git … commit|push` carrying a
 * `-c core.hooksPath=…` global option before the verb (relocating the hooks dir
 * disables husky without touching the flag at all); or that sets the `HUSKY=0`
 * kill switch. Segment-scoped: the flag / override must belong to the very
 * segment whose verb is commit/push — a `--no-verify` in a sibling `grep` /
 * `git log` segment, a `-n` on `git log` / `git rev-list`, or a `hooksPath`
 * mention in a sibling `grep` is not a bypass. The git invocation may sit inside
 * a shell-wrapper string (`bash -c "git commit -n"`, `sh -c '…'`, `$'…'`): the
 * opening quote is part of the git token and the matching close quote ends the
 * wrapped command (LUM-744 follow-up). Token-level so `-n"` glued to a
 * closing quote (message text) is not a flag; a free-standing flag inside quotes
 * is still a raw candidate, which the LUM-466 prose confirmation then drops.
 * Husky is this repo's only deterministic quality gate (pre-commit lint-staged +
 * commit-msg drift-check), so a bypass is a process boundary even though
 * nothing external is touched.
 */
function matchHookBypass(cmd: string): boolean {
  for (const seg of splitCommandSegments(cmd)) {
    if (HUSKY_OFF.test(seg)) return true
    if (segmentBypassesHooks(seg)) return true
  }
  return false
}

/** One shell segment: locate `git`, walk its global options up to the verb,
 *  then judge the verb-relative flags. */
function segmentBypassesHooks(seg: string): boolean {
  let toks = seg.trim().split(/\s+/)
  // `git`, `/usr/bin/git`, `(git`, `$(git`, `"git` — the LUM-736 `\bgit` recall.
  const gitAt = toks.findIndex(t => GIT_BINARY_TOKEN.test(t))
  if (gitAt < 0) return false

  // Wrapper-quoted git (`bash -c "git commit -n"`): the wrapped command ends at
  // the first later token carrying the matching unescaped close quote. Peel that
  // quote off (so `--no-verify"` / `push"` compare as flags / verb) and drop
  // everything after it — those tokens belong to the outer command. An inner
  // `-n\"` (escaped) or `-n"'` (other quote) stays glued and stays message text.
  const openQuote = toks[gitAt]!.match(GIT_BINARY_TOKEN)?.[1]
  if (openQuote) {
    const closeAt = toks.findIndex(
      (t, k) =>
        k > gitAt && t.endsWith(openQuote) && !t.endsWith('\\' + openQuote)
    )
    if (closeAt > gitAt)
      toks = [...toks.slice(0, closeAt), toks[closeAt]!.slice(0, -1)]
  }

  // Global options (between `git` and the subcommand). A hooksPath override
  // anywhere here is the bypass — but only once we know the verb is commit/push.
  let i = gitAt + 1
  let hooksPathOverride = false
  while (i < toks.length && toks[i]!.startsWith('-')) {
    const opt = toks[i]!
    if (HOOKS_PATH_OVERRIDE.test(opt)) hooksPathOverride = true
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(opt)) {
      const val = toks[i + 1]
      if (val !== undefined && HOOKS_PATH_OVERRIDE.test(val))
        hooksPathOverride = true
      i += 2
      continue
    }
    i += 1
  }
  const verb = toks[i]
  if (verb !== 'commit' && verb !== 'push') return false
  if (hooksPathOverride) return true

  // Verb-relative flags. Stop at `--`: everything after is pathspec/refspec.
  for (let j = i + 1; j < toks.length; j++) {
    const tok = toks[j]!
    if (tok === '--') break
    if (tok === '--no-verify') return true
    if (verb === 'commit' && COMMIT_SHORT_NO_VERIFY.test(tok)) return true
  }
  return false
}

/**
 * `rm` / `git rm` whose OWN delete targets are test files. Segment-scoped like
 * matchMigrationDelete (LUM-511): the test path must be an argument of the rm
 * verb, so `npx jest __tests__/x.test.ts && rm tmp.txt` (a sibling merely
 * referencing a test) does not trip. Distinct from TEST_TAMPERING, which is an
 * Edit/Write to a file a MACHINE checkpointer depends on — this is the Bash
 * delete of a test regardless of any contract.
 */
function matchTestFileDelete(cmd: string): boolean {
  for (const seg of splitCommandSegments(cmd)) {
    const m = seg.match(/(?:^|[\s(])(?:rm|git\s+rm)\b/)
    if (!m) continue
    const args = seg.slice((m.index ?? 0) + m[0].length)
    const deletesTest = args
      .split(/\s+/)
      .some(
        tok =>
          tok.length > 0 && !tok.startsWith('-') && TEST_FILE_TARGET.test(tok)
      )
    if (deletesTest) return true
  }
  return false
}

/**
 * Taxonomy-driven reversibility (LUM-435; reclassified LUM-516). Anchored on the
 * world/external-state boundary: a crossing is REVERSIBLE when it mutates only
 * repo or Lumo-internal state (restorable from git or Lumo state), and
 * IRREVERSIBLE only when it destroys external world state that neither git nor
 * Lumo can bring back — a leaked secret, dropped/exfiltrated/deleted data, or
 * terminated infra. Editorial crossings (test/criterion edits, laundered
 * spinoffs, silent fixes, migration-file deletes, unbound-session work,
 * protected-branch pushes) are reversible: `git restore` / archive-and-reopen /
 * a follow-up commit undoes the artifact.
 *
 * Reversibility is ORTHOGONAL to severity. The DONE gate blocks on severity
 * (HIGH), never on reversibility — so this classification weakens no gate; it
 * only sets the lock/unlock label and the loudness of the remediation nudge. Do
 * NOT "simplify" the editorial classes back to irreversible.
 *
 * Enumerate the reversible set; any unknown/future category falls through to
 * irreversible — the conservative default until it is deliberately classified.
 */
const REVERSIBLE_CATEGORIES: ReadonlySet<BoundaryCrossingCategory> = new Set([
  'NEW_NPM_DEPENDENCY',
  'TEST_TAMPERING',
  'CONTRACT_WEAKENING',
  'SPINOFF_LAUNDERED',
  'SILENT_FIX',
  'MIGRATION_FILE_DELETED',
  'SESSION_BINDING_MISSING',
  'PUSH_TO_PROTECTED_BRANCH',
  // LUM-630: a committed CLAUDE.md edit that removed/downgraded a rule is repo
  // state — `git restore` brings the rule back, same editorial class as
  // CONTRACT_WEAKENING.
  'POLICY_WEAKENING',
  // LUM-640: a steward-session commit is repo state (revertable) and a PR can
  // be closed — same world-state class as PUSH_TO_PROTECTED_BRANCH.
  'STEWARD_IMPLEMENTATION_ARTIFACT',
  // LUM-736: the L4 session-guard classes mutate repo state only (an edit, a
  // deleted tracked file) or skip a local hook — `git restore` / a follow-up
  // commit / re-running the hooks undoes each of them.
  'SENSITIVE_PATH_EDIT',
  'HOOK_BYPASS',
  'TEST_FILE_DELETED',
])

/** Target prefix stamped by the code pipeline on diff-based rule violations. */
const CODE_RULE_TARGET_PREFIX = 'coderule:'

export function isReversible(
  category: BoundaryCrossingCategory,
  target?: string | null
): boolean {
  // LUM-630: PROJECT_RULE_VIOLATION spans two origins with different
  // world-state footprints, so it is classified by target, not as a whole:
  // - `coderule:*` (code pipeline) — the violation is diff content, pure repo
  //   state, undone by a follow-up commit → reversible.
  // - `actionrule:*` (command matcher) — the matched command is arbitrary
  //   shell and may have touched external state → conservative irreversible,
  //   same default as an unknown category.
  if (category === 'PROJECT_RULE_VIOLATION') {
    return target?.startsWith(CODE_RULE_TARGET_PREFIX) === true
  }
  return REVERSIBLE_CATEGORIES.has(category)
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
    // LUM-491: unbound-session work is serious (session-binding lock bypass) but
    // deterministically detectable and not data-destructive, so MEDIUM.
    case 'SESSION_BINDING_MISSING':
    // LUM-511 Phase 4: criterion weakening (judge-confirmed) is tampering-class
    // but not data-destructive, so MEDIUM (like TEST_TAMPERING).
    case 'CONTRACT_WEAKENING':
    // LUM-511 Phase 6: judge-confirmed laundering (spinoff / silent-fix) — MEDIUM,
    // visible + dismissable, blocks DONE until a human acknowledges it.
    case 'SPINOFF_LAUNDERED':
    case 'SILENT_FIX':
    // LUM-640: implementation artifacts from a STEWARD (governance) session —
    // a role-boundary breach, deterministically detectable and repo-scoped
    // (like SESSION_BINDING_MISSING), so MEDIUM.
    case 'STEWARD_IMPLEMENTATION_ARTIFACT':
    // LUM-736 L4 Session Guard: deterministic, repo-scoped, not data-destructive
    // — visible + tiered, honours the workspace opt-out rather than force-gating.
    case 'SENSITIVE_PATH_EDIT':
    case 'HOOK_BYPASS':
    case 'TEST_FILE_DELETED':
    // LUM-793: deleting a proven-useful TRAP memory destroys team knowledge but
    // is not data-destructive to a customer's world — MEDIUM, in the same
    // visible-and-dismissable tier as TEST_FILE_DELETED (its nearest analogue:
    // "something that was protecting us stopped existing").
    case 'USED_TRAP_MEMORY_DELETED':
      return 'MEDIUM'
    case 'HARDCODED_SECRET':
    case 'DESTRUCTIVE_DB_COMMAND':
    case 'EXFILTRATION_PUBLIC':
    case 'CLOUD_DATA_DELETION':
    case 'INFRA_TERMINATION':
    // LUM-750 (reverted): the enum value stays (Postgres cannot drop one); it
    // is never produced, but it stays classified HIGH + irreversible so the
    // taxonomy table covers every enum value.
    case 'SELF_DISPOSITION':
      return 'HIGH'
    default:
      return 'MEDIUM'
  }
}

// --- LUM-640 steward implementation-artifact detection --------------------------

/**
 * LUM-640: the artifact classes a STEWARD (governance) session must not
 * produce — a git commit or a PR creation is implementation output, not
 * planning/acceptance. Segment-scanned like the other command matchers
 * (compound commands split on shell separators; a missed split only leaves
 * MORE text in a segment, erring toward flagging). Pure + exported for tests.
 *
 * Returns the matched kind + segment, or null when the command is clean.
 */
export function detectStewardImplementationArtifact(
  cmd: string
): { kind: 'git-commit' | 'pr-create'; segment: string } | null {
  for (const raw of splitCommandSegments(cmd)) {
    const seg = raw.trim()
    if (/^git(\s+\S+)*\s+commit\b/.test(seg)) {
      return { kind: 'git-commit', segment: seg }
    }
    if (/^gh\s+pr\s+create\b/.test(seg)) {
      return { kind: 'pr-create', segment: seg }
    }
  }
  return null
}

// --- LUM-442 evasion awareness (base64 decode-and-rescan) ---------------------

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

/** The command-shaped matchers, paired with their category — single source for
 *  both detection (matchCommand) and the coalescing fingerprint below. */
const COMMAND_MATCHERS: ReadonlyArray<{
  category: BoundaryCrossingCategory
  fn: (cmd: string) => boolean
}> = [
  { category: 'PUSH_TO_PROTECTED_BRANCH', fn: matchProtectedPush },
  { category: 'MIGRATION_FILE_DELETED', fn: matchMigrationDelete },
  { category: 'DESTRUCTIVE_DB_COMMAND', fn: matchDestructiveDb },
  { category: 'NEW_NPM_DEPENDENCY', fn: matchNewNpmDependency },
  { category: 'EXFILTRATION_PUBLIC', fn: matchExfiltrationPublic },
  { category: 'CLOUD_DATA_DELETION', fn: matchCloudDataDeletion },
  { category: 'INFRA_TERMINATION', fn: matchInfraTermination },
  // LUM-736 L4 Session Guard (segment-scoped; prose-confirmed via LUM-466).
  { category: 'HOOK_BYPASS', fn: matchHookBypass },
  { category: 'TEST_FILE_DELETED', fn: matchTestFileDelete },
]

/** The command-shaped categories, for parity guards in tests (LUM-772). */
export const COMMAND_MATCHER_CATEGORIES: ReadonlyArray<BoundaryCrossingCategory> =
  COMMAND_MATCHERS.map(m => m.category)

/**
 * The coalescing target (LUM-477) for an action-class crossing: the single shell
 * segment that actually tripped the matcher, NOT the whole command line. So
 * `pkill foo; echo "run 1"` and `pkill foo; echo "run 2"` both fingerprint to
 * `pkill foo` and coalesce into one open crossing — surrounding noise (a trailing
 * echo, a differing comment, an unrelated sibling command) no longer splits a
 * recurrence of the same dangerous action. Falls back to the whole command when
 * no single segment matches in isolation (e.g. a match that spans separators),
 * which keeps the conservative behaviour (its own crossing) rather than
 * over-merging.
 */
function fingerprintSegment(cmd: string, fn: (cmd: string) => boolean): string {
  for (const seg of splitCommandSegments(cmd)) {
    const t = seg.trim()
    if (t && fn(t)) return clip(t)
  }
  return clip(cmd)
}

/**
 * Run the command-shaped matchers and emit a crossing per hit.
 *
 * LUM-772: matchers only ever see the EXECUTING segments of the line. The
 * print / search / lumo / gh-authoring carriers (`echo`, `grep`, `cat`,
 * `lumo crossing explain --note "…"`, `gh pr create --body "…"`) are dropped
 * deterministically — their arguments are text, never actions — so a note
 * quoting `git push origin main` can no longer even become a candidate (the
 * LUM-466 LLM step used to be the only thing standing between it and a
 * recorded crossing, and it is allowed to fail closed). `git …` segments are
 * all kept (`keepGit`): a `git commit` IS the action for HOOK_BYPASS, and its
 * message prose stays the confirmation step's call. Heredoc bodies are kept
 * too — an interpreter (`bash <<EOF`) may execute them; Stage 1 + the judge
 * decide. A `bash -c '…'` wrapper is unwrapped, so a wrapped real action is
 * still matched and a wrapped grep is still a grep. A heredoc body rides with
 * the segment that opens it, so `cat > f <<EOF` (with whatever the body says)
 * is dropped whole, while `bash <<EOF` / `git commit -F - <<EOF` keep theirs
 * for the matcher — and, for the latter, the confirmation step.
 */
function matchCommand(cmd: string, evasion: boolean): DetectedCrossing[] {
  const out: DetectedCrossing[] = []
  // The carrier-free command: executing segments only, re-joined so a matcher
  // that reads context across segments (an env var + a curl) still sees it.
  const executing = executingSegments(cmd, { keepGit: true }).join('\n')
  for (const { category, fn } of COMMAND_MATCHERS) {
    if (!fn(executing)) continue
    out.push({
      category,
      detail: clip(evasion ? `${EVASION_MARKER}${cmd}` : cmd),
      // Evasion is itself OpenAI's highest-frequency class — always HIGH.
      severity: evasion ? 'HIGH' : severityFor(category),
      // Coalesce on the matched forbidden segment, not the whole line (LUM-477)
      // — the same action recurs as one crossing even amid differing noise.
      target: fingerprintSegment(cmd, fn),
    })
  }
  return out
}

/**
 * LUM-779: judge TEST_FILE_DELETED by NET deletion, not by command text.
 *
 * The matcher answers "did the command look like it deleted a test file". That
 * is the wrong question — the same question POLICY_WEAKENING asked before
 * LUM-770 ("did the rule set change" instead of "is the rule text still in the
 * file"). Four production hits in one day were a restore from HEAD, a restore
 * from a .bak, and two `rm`s of scratch probes the agent had created seconds
 * earlier and that never entered git. None deleted a test; all blocked DONE.
 * Worse, they landed on the task doing the most rigorous mutation testing —
 * a guard that makes the right thing expensive.
 *
 * The right question is "is a tracked test file missing now". The CLI answers
 * it from local git (`readDeletedTestFiles`), and this step applies the verdict:
 *   - probe ran, ≥1 tracked test missing → blocking, as before (detail names them)
 *   - probe ran, nothing missing          → advisory: recorded, never blocks DONE
 *   - probe did not run                   → unchanged: fail-closed (blocking)
 *
 * The path matcher is deliberately NOT loosened (no "/tmp doesn't count"): a
 * real deletion of a tracked test must block exactly as before — the fix for a
 * false positive must not disarm the true positive (the LUM-770 lesson).
 * Pure + exported for tests.
 */
export function applyNetDeletionState(
  crossings: DetectedCrossing[],
  deleted: string[] | null
): DetectedCrossing[] {
  if (deleted === null) return crossings
  return crossings.map(c => {
    if (c.category !== 'TEST_FILE_DELETED') return c
    // Verdict first: `clip` caps the detail, and the verdict must survive a
    // long command line — the command is also the coalescing target.
    if (deleted.length > 0) {
      return {
        ...c,
        detail: clip(
          `Tracked test file(s) missing after this command: ${deleted.join(', ')} — ${c.detail}`
        ),
      }
    }
    return {
      ...c,
      advisory: true,
      detail: clip(
        `No tracked test file is missing after this command (a restore, or an untracked scratch file) — advisory — ${c.detail}`
      ),
    }
  })
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
    // LUM-779: TEST_FILE_DELETED is judged by what is missing from the repo,
    // not by what the command text looked like. Only the literal pass is
    // eligible — an evasion-decoded delete keeps its HIGH, never advisory.
    out.push(
      ...applyNetDeletionState(literal, readDeletedTestFiles(input.payload))
    )
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
    const hit = scanWrittenContent(
      content,
      checkoutRelativePath(input.filePath, input.payload)
    )
    if (hit) {
      const file = input.filePath ?? UNKNOWN_WRITTEN_FILE
      // A downgraded hit (placeholder value / test-fixture-doc path) is still
      // recorded — but LOW and advisory, so it never blocks DONE: the same
      // "recorded, never blocking" stance the PR scanner takes for LOW.
      // LUM-893: so is a broad-shape / test-key rule, and any hit in a file
      // the hook's probe found gitignored (never reaches git). LUM-899: the
      // probe's answer wins — `false` (tracked / not ignored) is judged as any
      // file; the local-env filename guess applies only without an answer and
      // only to a broad-shape rule. LUM-903: an untrusted `true` under
      // `.worktrees/` counts as no answer (LUM-908: trusted with the marker).
      const probe = trustedWrittenPathIgnored(input.payload, input.filePath)
      const where = {
        local:
          probe === null &&
          isShapeRule(hit.ruleId) &&
          isLocalEnvFile(input.filePath),
        ignored: probe === true,
      }
      const downgraded =
        isAdvisorySecretHit(hit) || where.local || where.ignored
      out.push({
        category: 'HARDCODED_SECRET',
        // Never echo the secret — store the pattern title + file only.
        detail: clip(
          `${hit.title} in ${file}${secretDowngradeSuffix(hit, where)}`
        ),
        // The registry's severity for the pattern (HIGH/MEDIUM), or LOW when
        // downgraded — `severityFor('HARDCODED_SECRET')` stays the category's
        // taxonomy ceiling, not the per-hit value.
        severity: hit.severity,
        // Coalesce by the written FILE, never the secret value (LUM-477) —
        // repeated secret writes to the same file merge into one crossing.
        target: file,
        ...(downgraded ? { advisory: true } : {}),
      })
    }
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
  /**
   * Has this criterion's MACHINE check ever recorded a PASS (LUM-449 authoring
   * gate)? You cannot reward-hack by weakening a test that was never green, so a
   * hit is suppressed when `everPassed === false` — the criterion is still being
   * authored, not gamed. `undefined` (legacy callers) defaults to the flagging
   * (safe) direction; only an explicit `false` suppresses. See detectTestTampering.
   */
  everPassed?: boolean | undefined
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

/** Pull an Edit's before/after strings out of a hook payload (Edit `old_string`
 *  + `new_string`, with the `_str` aliases). A Write has no `old_*`, so its
 *  before side is null — there is nothing to diff against. */
function readEditStrings(payload: unknown): {
  oldString: string | null
  newString: string | null
} {
  const empty = { oldString: null, newString: null }
  if (!payload || typeof payload !== 'object') return empty
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return empty
  const o = input as Record<string, unknown>
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) if (typeof o[k] === 'string') return o[k] as string
    return null
  }
  return {
    oldString: pick('old_string', 'old_str'),
    newString: pick('new_string', 'new_str', 'content'),
  }
}

/**
 * Strip JS/TS comments while preserving string-literal contents (LUM-455). A
 * single quote-aware pass — a `//` or `/* *​/` inside a `'`/`"`/`` ` `` literal is
 * NOT a comment and is left untouched, so a changed URL like `'https://a'` →
 * `'https://b'` is never mistaken for a comment-only (cosmetic) edit. Erring
 * toward keeping text (the conservative direction) is the whole point.
 */
function stripComments(src: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const next = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\' && i + 1 < src.length) {
        out += src[i + 1] // copy the escaped char verbatim
        i++
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      out += c
      continue
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++ // skip to EOL, keep newline
      out += '\n'
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i++ // land on '/', loop ++ skips it
      continue
    }
    out += c
  }
  return out
}

/**
 * Normalize a chunk of test source to its significant lines for a cosmetic-vs-
 * substantive comparison (LUM-455): drop comments, strip postfix non-null
 * assertions (`!`), collapse whitespace, drop blank lines, and sort so a pure
 * line reorder compares equal. Deliberately narrow: it normalizes ONLY the
 * cosmetic forms it can prove safe; anything else (a changed value, a TS type
 * annotation, an `as` cast) is left intact so the edit reads as substantive and
 * is still flagged. Conservative by construction — see isCosmeticTestEdit.
 */
function normalizeTestLines(text: string): string[] {
  return stripComments(text)
    .split('\n')
    .map(line =>
      // Postfix non-null assertion `!` (followed by . ; , ) ] } or EOL); never a
      // `!=`/`!==` operator (followed by `=`) and never a prefix logical-not.
      line.replace(/!(?=\s*[.;,)\]}]|$)/g, '')
    )
    .map(line => line.replace(/\s+/g, ''))
    .filter(line => line.length > 0)
    .sort()
}

/**
 * Is an Edit provably cosmetic-only (LUM-455)? True ONLY when the before/after
 * normalize to the identical set of significant lines — i.e. the edit is limited
 * to whitespace, comments, non-null assertions, or pure line reordering. A
 * missing side (a Write, or a payload with no old_string) returns FALSE: with
 * nothing to diff against we cannot prove the edit harmless, so it stays flagged.
 * This is the safety property — a real assertion change, deletion, or any edit we
 * can't confidently classify as non-substantive is never suppressed (criterion 2).
 */
export function isCosmeticTestEdit(
  oldString: string | null,
  newString: string | null
): boolean {
  if (oldString == null || newString == null) return false
  const a = normalizeTestLines(oldString)
  const b = normalizeTestLines(newString)
  if (a.length !== b.length) return false
  return a.every((line, i) => line === b[i])
}

/**
 * Is an Edit purely additive (LUM-455)? True when every significant line of the
 * BEFORE side still survives, unchanged, in the AFTER side (old's normalized
 * lines are a sub-multiset of new's) — i.e. the edit only INTRODUCES lines (a
 * new test case, a new import, a new comment) and removes/alters nothing. A pure
 * addition cannot weaken an existing assertion, so it is treated as
 * non-substantive and suppressed.
 *
 * Deliberate, signed-off relaxation of the conservative red line: because lines
 * are compared independently, an inserted statement that MUTATES prior state
 * (e.g. reassigning a `let` the assertion reads) would also pass. That residual
 * hole is the accepted cost of dropping new-test/new-import noise; an edit that
 * removes or alters any existing line is still flagged. A missing side (a Write,
 * no before) is never additive — there is nothing to compare against.
 */
export function isAdditiveTestEdit(
  oldString: string | null,
  newString: string | null
): boolean {
  if (oldString == null || newString == null) return false
  const before = normalizeTestLines(oldString)
  if (before.length === 0) return false
  const counts = new Map<string, number>()
  for (const line of normalizeTestLines(newString)) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  for (const line of before) {
    const n = counts.get(line) ?? 0
    if (n === 0) return false // a before-line is gone → removed or altered
    counts.set(line, n - 1)
  }
  return true
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
 *
 * LUM-455 adds a PRECISION gate: a hit whose edit is provably non-substantive —
 * cosmetic-only (whitespace/comments/non-null assertions/reordering) OR purely
 * additive (only new lines; nothing existing removed or altered) — is suppressed
 * as noise. The gate stays conservative for the threat that matters: an edit that
 * removes or alters an existing line, a Write, or an unparseable payload is still
 * recorded (criterion 2).
 */
export function detectTestTampering(input: {
  toolName: string | null
  filePath: string | null
  machineCheckpointers: MachineCheckpointer[]
  payload?: unknown
}): DetectedCrossing | null {
  if (!input.filePath) return null
  if (!input.toolName || !WRITE_TOOLS.includes(input.toolName)) return null
  for (const mc of input.machineCheckpointers) {
    const hit = checkpointerFilePaths(mc.checkpointer).find(p =>
      eventPathMatchesCheckpointerPath(input.filePath as string, p)
    )
    if (hit) {
      // Authoring gate (LUM-449): a hit on a criterion whose MACHINE check has
      // never passed is the agent authoring the test (TDD red→green), not
      // weakening a green one — the measured 100%-FP shape. There is no metric
      // to game until the check has been green once, so suppress it. An absent
      // signal (legacy caller) keeps the safe, flagging direction.
      if (mc.everPassed === false) return null
      // Precision gate (LUM-455): drop a provably non-substantive edit —
      // cosmetic-only or purely additive; keep everything else (the safe
      // direction: removals/alterations, Writes, unparseable payloads).
      const { oldString, newString } = readEditStrings(input.payload)
      if (
        isCosmeticTestEdit(oldString, newString) ||
        isAdditiveTestEdit(oldString, newString)
      ) {
        return null
      }
      const because = mc.statement
        ? ` — a MACHINE check depends on it ("${mc.statement}")`
        : ' — a MACHINE check depends on it'
      return {
        category: 'TEST_TAMPERING',
        detail: clip(`edited ${hit}${because}`),
        severity: severityFor('TEST_TAMPERING'),
        // Coalesce repeated edits to the SAME test file (LUM-477): the edited
        // file is the target, so three edits to one test = one OPEN crossing.
        target: normalizePath(input.filePath as string),
      }
    }
  }
  return null
}

// --- LUM-463: two-stage precision (deterministic pre-filter + LLM judge) ------
//
// A surviving TEST_TAMPERING hit is still ambiguous: a substantive edit to an
// already-green test can be a legitimate update (conditions/spec changed) or a
// weakening (loosened to force a fake PASS). The deterministic pre-filter
// (Stage 1) decides the clear ends for free; only the ambiguous residual reaches
// the best-effort LLM judge (Stage 2). The judge only DOWNGRADES (severity LOW)
// or FLAGS — it never hard-clears a crossing and never sets a human disposition
// (LUM-435/422 stay the final arbiter). Every path here is defensive: a failure
// keeps the base (flagged) crossing — a possible weakening is never silently
// suppressed, and a downgraded crossing still gets recorded (visible/auditable).

const TEST_PATH_RE = /\.(?:test|spec)\.[tj]sx?$/
const PRODUCTION_CODE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|prisma)$/
const CODE_DIFF_CAP = 8_000

/** Audit note stamped on a system AUTO_LEGIT auto-resolution (LUM-478) — names
 *  WHY it was auto-cleared so an auditor reading the crossing later sees the
 *  deterministic reason, not a bare disposition. */
const AUTO_LEGIT_NOTE =
  'Auto-resolved by the detector: deterministic high-confidence legit (production code co-changed, assertions intact). Not a human disposition — re-openable.'

/** Pull a write event's target file path out of its stored payload. */
function readEventFilePath(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  for (const k of ['file_path', 'filePath', 'path', 'notebook_path']) {
    if (typeof o[k] === 'string') return o[k] as string
  }
  return null
}

function isProductionCodePath(p: string): boolean {
  return PRODUCTION_CODE_RE.test(p) && !TEST_PATH_RE.test(p)
}

/**
 * Signal A — change-set context. Did the task's write events touch production
 * (non-test) source alongside the test? Returns the boolean plus a bounded code
 * diff for the judge. `coChanged: null` means the signal could not be computed
 * (query failed) — the safe direction (no positive legit evidence → no
 * downgrade). Best-effort: never throws.
 */
async function gatherChangeSetContext(
  taskId: string
): Promise<{ coChanged: boolean | null; codeDiff: string | null }> {
  try {
    const events = await hookEventRepository.findByTaskId(taskId)
    const productionSnippets: string[] = []
    for (const e of events) {
      if (!e.toolName || !WRITE_TOOLS.includes(e.toolName)) continue
      const fp = readEventFilePath(e.payload)
      if (!fp || !isProductionCodePath(fp)) continue
      const { oldString, newString } = readEditStrings(e.payload)
      // Production-code content is not retained on stored events (LUM-855):
      // the judge still learns the file was co-changed, just not how.
      const body =
        oldString == null && newString == null && hasRedactedContent(e.payload)
          ? '(content not retained)'
          : buildEditDiff(oldString, newString)
      productionSnippets.push(`# ${fp}\n${body}`)
    }
    const coChanged = productionSnippets.length > 0
    const joined = productionSnippets.join('\n\n')
    const codeDiff = coChanged
      ? joined.length > CODE_DIFF_CAP
        ? `${joined.slice(0, CODE_DIFF_CAP)}\n…[truncated]`
        : joined
      : null
    return { coChanged, codeDiff }
  } catch {
    return { coChanged: null, codeDiff: null }
  }
}

/**
 * Signal C — was the backing criterion itself edited (a CRITERION_CHANGED UPDATE
 * after the initial draft)? A moved spec is a legitimate reason for the test to
 * move. Best-effort: a query failure returns false (the safe direction — absence
 * of evidence never downgrades).
 */
async function backingCriterionEdited(
  taskId: string,
  criterionId: string
): Promise<boolean> {
  try {
    const acts = await activityRepository.listByTaskAndType(
      taskId,
      'CRITERION_CHANGED'
    )
    return acts.some(a => {
      const p = a.payload as Record<string, unknown> | null
      return !!p && p.criterionId === criterionId && p.op === 'UPDATED'
    })
  } catch {
    return false
  }
}

/** Render an Edit's before→after as a compact diff for the judge prompt. */
function buildEditDiff(
  oldString: string | null,
  newString: string | null
): string {
  if (oldString == null) return `+++ after\n${newString ?? ''}`
  return `--- before\n${oldString}\n+++ after\n${newString ?? ''}`
}

// Diff-hash cache so an identical (criterion, test-diff, code-diff) is judged
// once per process (cost-bounding on top of the pre-filter). Failures are NOT
// cached, so a transient gateway error re-tries on the next hit.
const judgeCache = new Map<string, Promise<JudgeVerdict>>()
const JUDGE_CACHE_MAX = 500

/**
 * Cache key for one judge call. The three fields are joined with a NUL,
 * which cannot occur inside a diff or a criterion statement.
 *
 * LUM-796: the separator is written as the escape `\u0000`, never as a
 * literal 0x00 byte — a literal NUL makes grep/rg classify this whole
 * file as binary and silently return no matches. Exported so the escape's
 * byte-identity is pinned by a golden vector in the guard test.
 */
export function judgeCacheKey(j: JudgeInput): string {
  return createHash('sha256')
    .update(`${j.criterion}\u0000${j.testDiff}\u0000${j.codeDiff ?? ''}`)
    .digest('hex')
}

function cachedJudge(j: JudgeInput): Promise<JudgeVerdict> {
  const key = judgeCacheKey(j)
  const hit = judgeCache.get(key)
  if (hit) return hit
  // Lazy import: pay the SDK load only when the model is actually consulted.
  const p = import('@/lib/llm/test-tampering-judge-client').then(mod =>
    mod.judgeTestTampering(j)
  )
  judgeCache.set(key, p)
  p.catch(() => judgeCache.delete(key))
  if (judgeCache.size > JUDGE_CACHE_MAX) {
    const oldest = judgeCache.keys().next().value
    if (oldest !== undefined) judgeCache.delete(oldest)
  }
  return p
}

/** The MACHINE checkpointer whose test file this edit hit (mirrors the order in
 *  detectTestTampering, which returns on the first match). */
function findMatchedCheckpointer(
  machineCheckpointers: MachineCheckpointer[],
  filePath: string
): MachineCheckpointer | null {
  for (const mc of machineCheckpointers) {
    const hit = checkpointerFilePaths(mc.checkpointer).find(p =>
      eventPathMatchesCheckpointerPath(filePath, p)
    )
    if (hit) return mc
  }
  return null
}

/**
 * The pre-loaded context the two-stage tampering classifier (LUM-463) needs,
 * lifted out of the DB so the classification core is a pure, injectable seam:
 * the production wrapper fills it from the repositories, the alignment eval
 * (LUM-468) fills it from fixtures — both run the identical classifier.
 */
export interface TaskTamperingContext {
  /** The bound task's MACHINE checkpointers (with their `everPassed` flags). */
  machineCheckpointers: MachineCheckpointer[]
  /** Signal A — did the task's change-set co-touch production code? (`null` = uncomputable). */
  productionCodeCoChanged: boolean | null
  /** The bounded co-changed code diff for the judge prompt (`null` = none). */
  codeDiff: string | null
  /** Signal C — the criterion ids whose backing spec was edited after the draft. */
  changedCriterionIds: ReadonlySet<string>
}

/**
 * Run the two-stage classification on a surviving tampering crossing and return
 * the crossing adjusted for the verdict: LEGIT → severity LOW + a "downgraded"
 * note (still recorded, just not full-strength); WEAKENING → the base crossing
 * unchanged (full strength). Defensive by construction — any failure returns the
 * base (flagged) crossing, so a downgrade only ever happens on a positive
 * legit/judge verdict and a crossing is never lost. Context + judge are injected
 * (no DB, no lazy LLM import here), so the eval drives this exact path.
 */
async function annotateTampering(
  payload: unknown,
  matched: MachineCheckpointer,
  base: DetectedCrossing,
  ctx: TaskTamperingContext,
  judge: TamperingJudge
): Promise<DetectedCrossing> {
  try {
    const { oldString, newString } = readEditStrings(payload)
    const criterionChanged = matched.criterionId
      ? ctx.changedCriterionIds.has(matched.criterionId)
      : false
    const result = await classifyTestTampering(
      {
        oldString,
        newString,
        productionCodeCoChanged: ctx.productionCodeCoChanged,
        backingCriterionChanged: criterionChanged,
      },
      {
        testDiff: buildEditDiff(oldString, newString),
        codeDiff: ctx.codeDiff,
        criterion: matched.statement ?? '',
      },
      { judge }
    )
    if (result.outcome === 'LEGIT') {
      // LUM-478: a DETERMINISTIC pre-filter LEGIT (positive signals: production
      // code co-changed + assertions intact) is high-confidence enough to
      // auto-resolve; a judge-only (LLM) LEGIT stays a human-dispositioned LOW
      // crossing — the LLM is not trusted to auto-clear the DONE gate. The detail
      // keeps the "downgraded (legit, …)" marker either way (the alignment eval
      // and read model key on it), and `autoResolve` carries the recorder's
      // auto-disposition decision.
      const fromPrefilter = result.stage === 'PREFILTER'
      const how = fromPrefilter ? 'pre-filter' : 'judge'
      return {
        ...base,
        severity: 'LOW',
        detail: clip(`${base.detail} · downgraded (legit, ${how})`),
        ...(fromPrefilter ? { autoResolve: true } : {}),
      }
    }
    return base
  } catch {
    return base
  }
}

/**
 * Pure (no-DB) TEST_TAMPERING classification core (LUM-441 + LUM-463): run the
 * deterministic tampering check against pre-loaded context, then refine a
 * surviving hit through the two-stage precision classifier with an injected
 * judge. The production wrapper (`detectTestTamperingForTask`) loads `ctx` from
 * the repositories and passes the cached LLM judge; the alignment eval (LUM-468)
 * passes fixture context and a deterministic stub judge — so both exercise the
 * exact same classification path with no live database.
 */
export async function classifyTaskTampering(
  input: Pick<BoundaryDetectionInput, 'toolName' | 'filePath' | 'payload'>,
  ctx: TaskTamperingContext,
  judge: TamperingJudge
): Promise<DetectedCrossing | null> {
  const base = detectTestTampering({
    toolName: input.toolName,
    filePath: input.filePath,
    machineCheckpointers: ctx.machineCheckpointers,
    payload: input.payload,
  })
  if (!base) return null
  const matched = findMatchedCheckpointer(
    ctx.machineCheckpointers,
    input.filePath as string
  )
  if (!matched) return base
  return annotateTampering(input.payload, matched, base, ctx, judge)
}

/**
 * Load the bound task's MACHINE checkpointers and run the pure tampering check
 * (LUM-441). Gated up front: only an Edit/Write event carrying a file path can
 * tamper with a test, so a Bash/Read/Stop event short-circuits BEFORE any DB
 * read — the criteria query is paid only on the events that can match. A
 * surviving hit is then run through the LUM-463 two-stage precision classifier;
 * the change-set context (signals A/C) is loaded ONLY on an actual hit so a miss
 * never pays for it. Delegates to the injectable `classifyTaskTampering` core.
 */
async function detectTestTamperingForTask(
  input: BoundaryDetectionInput
): Promise<DetectedCrossing | null> {
  if (!input.filePath) return null
  if (!input.toolName || !WRITE_TOOLS.includes(input.toolName)) return null
  const criteria = await acceptanceCriterionRepository.listByTask(input.taskId)
  const machineCriteria = criteria.filter(
    c => c.verifierType === 'MACHINE' && !!c.checkpointer
  )
  if (machineCriteria.length === 0) return null
  // Authoring gate (LUM-449): a MACHINE check that has never gone green is still
  // being authored, so an edit to its test is not yet reward-hacking. One read,
  // scoped to this task's criteria, indexed by criterionId.
  const everPassed = await verificationRunRepository.criterionIdsEverPassed(
    machineCriteria.map(c => c.id)
  )
  const machineCheckpointers: MachineCheckpointer[] = machineCriteria.map(
    c => ({
      criterionId: c.id,
      statement: c.statement,
      checkpointer: c.checkpointer as string,
      everPassed: everPassed.has(c.id),
    })
  )
  // Cheap base check first: only pay the change-set context (signals A/C) when an
  // edit actually hits a checkpointer-backed test — a miss reads nothing more.
  const base = detectTestTampering({
    toolName: input.toolName,
    filePath: input.filePath,
    machineCheckpointers,
    payload: input.payload,
  })
  if (!base) return null
  const matched = findMatchedCheckpointer(machineCheckpointers, input.filePath)
  if (!matched) return base
  const changeSet = await gatherChangeSetContext(input.taskId)
  const changedCriterionIds =
    matched.criterionId &&
    (await backingCriterionEdited(input.taskId, matched.criterionId))
      ? new Set<string>([matched.criterionId])
      : new Set<string>()
  return annotateTampering(
    input.payload,
    matched,
    base,
    {
      machineCheckpointers,
      productionCodeCoChanged: changeSet.coChanged,
      codeDiff: changeSet.codeDiff,
      changedCriterionIds,
    },
    cachedJudge
  )
}

// --- LUM-466: action-category prose-vs-real confirmation ----------------------
//
// The deterministic command matchers are high-recall and also trip on a
// forbidden token that appears only as PROSE — inside a commit message, a PR
// body, an echo string. For each action-category candidate we re-run the
// matchers on a prose-stripped copy of the command: a category that STILL
// matches outside all quotes/heredocs is a real executed action (certain → flag,
// no LLM call); one that vanished matched only prose and is handed to the
// best-effort LLM confirmation, which suppresses it ONLY on a clear PROSE_ONLY
// verdict. Conservative + observe-only throughout (criteria 2/3).

// Process-level cache so an identical (category, command) is confirmed once.
// Failures are NOT cached, so a transient gateway error re-tries on the next hit.
const actionConfirmCache = new Map<string, Promise<ActionConfirmVerdict>>()
const ACTION_CONFIRM_CACHE_MAX = 500

function actionConfirmCacheKey(input: ActionConfirmInput): string {
  return createHash('sha256')
    .update(`${input.category}\n${input.command}`)
    .digest('hex')
}

function cachedActionConfirm(
  input: ActionConfirmInput
): Promise<ActionConfirmVerdict> {
  const key = actionConfirmCacheKey(input)
  const hit = actionConfirmCache.get(key)
  if (hit) return hit
  // Lazy import: pay the SDK load only when the model is actually consulted.
  const p = import('@/lib/llm/action-confirm-client').then(mod =>
    mod.confirmActionExecuted(input)
  )
  actionConfirmCache.set(key, p)
  p.catch(() => actionConfirmCache.delete(key))
  if (actionConfirmCache.size > ACTION_CONFIRM_CACHE_MAX) {
    const oldest = actionConfirmCache.keys().next().value
    if (oldest !== undefined) actionConfirmCache.delete(oldest)
  }
  return p
}

/**
 * Confirm the action-category candidates in `crossings` against the command:
 * keep every non-action crossing untouched; keep an action crossing that still
 * matches on the prose-stripped command (a real, deterministically-certain
 * action — NO LLM call); for one that matched ONLY inside prose, ask the
 * best-effort LLM and DROP it only on a clear PROSE_ONLY verdict (REAL_ACTION /
 * uncertain / failure keeps it). Defensive throughout — any error keeps the base
 * (flagged) crossing, so a candidate is never silently lost (criteria 2/3).
 */
export async function confirmActionCandidates(
  input: Pick<BoundaryDetectionInput, 'payload'>,
  crossings: DetectedCrossing[],
  judge: ActionConfirmJudge = cachedActionConfirm
): Promise<DetectedCrossing[]> {
  const cmd = readCommand(input.payload)
  // Without a command string there is no prose to strip and nothing to confirm
  // (a Write's HARDCODED_SECRET, etc.) — pass the crossings through untouched.
  if (!cmd) return crossings
  // Stage 1: which categories still match OUTSIDE all prose? Those are real,
  // deterministically-certain actions and never reach the LLM.
  let certain: Set<BoundaryCrossingCategory>
  try {
    certain = new Set(matchCommand(stripProse(cmd), false).map(c => c.category))
  } catch {
    // If de-prose itself fails, keep every flag (the conservative direction).
    return crossings
  }
  const out: DetectedCrossing[] = []
  for (const c of crossings) {
    if (!isActionConfirmCategory(c.category)) {
      out.push(c) // HARDCODED_SECRET / NEW_NPM_DEPENDENCY / TEST_TAMPERING
      continue
    }
    // Evasion-decoded crossings (base64) are deliberate obfuscation, already
    // HIGH — never let the LLM suppress one (the high-severity red line).
    if (isEvasionDecoded(c.detail)) {
      out.push(c)
      continue
    }
    if (certain.has(c.category)) {
      out.push(c) // matched outside prose → a real action, flagged without the LLM
      continue
    }
    // Prose candidate → best-effort confirmation. Suppress only on PROSE_ONLY;
    // REAL_ACTION / uncertain / failure keeps the candidate flagged.
    let verdict: ActionConfirmVerdict
    try {
      verdict = await confirmActionCrossing(
        { command: cmd, category: c.category },
        { judge }
      )
    } catch {
      verdict = 'REAL_ACTION'
    }
    if (verdict === 'PROSE_ONLY') continue
    out.push(c)
  }
  return out
}

/** Best-effort one-line summary of an Edit/Write payload for the silent-fix judge. */
function summarizeEdit(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const root = payload as Record<string, unknown>
    const input = (root.tool_input ?? root) as Record<string, unknown>
    const parts: string[] = []
    if (typeof input.old_string === 'string')
      parts.push(`- old: ${input.old_string}`)
    if (typeof input.new_string === 'string')
      parts.push(`+ new: ${input.new_string}`)
    else if (typeof input.content === 'string') parts.push(input.content)
    if (parts.length) return parts.join('\n')
  }
  return '(edit content unavailable)'
}

/**
 * LUM-511 Phase 4 (silent-fix): when a file edit lands on a task that has already
 * been submitted for acceptance (ever entered IN_REVIEW) with NO recorded
 * send-back, the agent may be silently fixing a defect that should have left a
 * send-back trace. Judge REAL_FIX vs COSMETIC and, on REAL_FIX, record a
 * task-level SILENT_FIX_DETECTED marker (one per task) for the flywheel negative
 * class. Cheap short-circuits run before any DB/LLM work; audit-only.
 */
export async function recordSilentFixIfDetected(
  input: BoundaryDetectionInput
): Promise<void> {
  if (!input.toolName || !WRITE_TOOLS.includes(input.toolName)) return
  if (!input.filePath) return
  const statusChanges = await activityRepository.listByTaskAndType(
    input.taskId,
    'STATUS_CHANGED'
  )
  const everInReview = statusChanges.some(
    a => (a.payload as { toStatus?: string } | null)?.toStatus === 'IN_REVIEW'
  )
  if (!everInReview) return
  // A recorded send-back means the fix is a normal, traced rework — not silent.
  const sendBacks = await verificationRunRepository.taskIdsWithSendBack([
    input.taskId,
  ])
  if (sendBacks.size > 0) return
  // LUM-511 Phase 6: dedup on (taskId, SILENT_FIX, filePath) — if this file's
  // silent fix was already flagged, bump it and skip the LLM call (cost guard).
  const coalesced = await boundaryCrossingRepository.coalesceRecurrence(
    input.taskId,
    'SILENT_FIX',
    input.filePath,
    new Date()
  )
  if (coalesced > 0) return
  const { classifySilentFix } =
    await import('@/lib/boundary-crossing/silent-fix-judge')
  const { judgeSilentFix } = await import('@/lib/llm/silent-fix-judge-client')
  const verdict = await classifySilentFix(
    { filePath: input.filePath, editSummary: summarizeEdit(input.payload) },
    { judge: judgeSilentFix }
  )
  if (verdict !== 'REAL_FIX') return
  // Phase 6: a DONE-blocking, dismissable crossing on the task (was a marker).
  await boundaryCrossingRepository.create({
    taskId: input.taskId,
    hookEventId: input.hookEventId ?? null,
    category: 'SILENT_FIX',
    detail: `Post-review edit to ${input.filePath} with no recorded send-back — judged a real defect fix (should have left a send-back trace).`,
    target: input.filePath,
    reversible: isReversible('SILENT_FIX'),
    severity: 'MEDIUM',
  })
}

// --- LUM-736: SENSITIVE_PATH_EDIT (Edit/Write on a sensitive path) ------------

/**
 * The built-in sensitive-path rules, matched against the normalized event path
 * on path-segment boundaries (so `lib/authz.ts` / `lib/author/` never match the
 * `auth/` rule). Each carries a short label for the crossing detail.
 */
const DEFAULT_SENSITIVE_PATH_RULES: ReadonlyArray<{
  label: string
  re: RegExp
}> = [
  { label: 'auth/', re: /(?:^|\/)auth\// },
  {
    label: 'middleware.ts / proxy.ts',
    re: /(?:^|\/)(?:middleware|proxy)\.ts$/,
  },
  { label: '.github/workflows/', re: /(?:^|\/)\.github\/workflows\// },
  {
    label: 'lockfile',
    re: /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  },
  { label: 'prisma/schema.prisma', re: /(?:^|\/)prisma\/schema\.prisma$/ },
]

/**
 * The project's own sensitive-path globs (LUM-736): deterministic `path-glob`
 * rules the policy compiler mapped to SENSITIVE_PATH_EDIT. Non-empty → they
 * REPLACE the built-in path set for that project (an override, not a union);
 * empty → the defaults apply. Pure.
 */
export function sensitivePathGlobsFromRules(rules: PolicyRule[]): string[] {
  return rules
    .filter(
      r =>
        r.tier === 'deterministic' &&
        r.mappedCategory === 'SENSITIVE_PATH_EDIT' &&
        r.predicate?.type === 'path-glob' &&
        r.predicate.value.length > 0
    )
    .map(r => (r.predicate as { value: string }).value)
}

/** A repo-relative glob must also match the tail of an absolute event path. */
function matchSensitiveGlob(glob: string, path: string): boolean {
  if (matchPathGlob(glob, [path])) return true
  return !glob.startsWith('**') && !glob.startsWith('/')
    ? matchPathGlob(`**/${glob}`, [path])
    : false
}

/**
 * An Edit/Write that lands on a sensitive path (LUM-736 L4). Pure — the
 * project's override globs are passed in; the caller loads them from the
 * compiled policy best-effort. Only write tools carrying a file path can match;
 * a Read / Bash event returns null before any work. Coalesces on the normalized
 * file (LUM-477): three edits to one auth file = one OPEN crossing.
 */
export function detectSensitivePathEdit(input: {
  toolName: string | null
  filePath: string | null
  sensitivePathGlobs?: readonly string[] | null
}): DetectedCrossing | null {
  if (!input.filePath) return null
  if (!input.toolName || !WRITE_TOOLS.includes(input.toolName)) return null
  const path = normalizePath(input.filePath)
  const globs = input.sensitivePathGlobs ?? []
  let label: string | null = null
  if (globs.length > 0) {
    label = globs.find(g => matchSensitiveGlob(g, path)) ?? null
  } else {
    label =
      DEFAULT_SENSITIVE_PATH_RULES.find(r => r.re.test(path))?.label ?? null
  }
  if (label == null) return null
  return {
    category: 'SENSITIVE_PATH_EDIT',
    detail: clip(`edited sensitive path ${path} (matched ${label})`),
    severity: severityFor('SENSITIVE_PATH_EDIT'),
    target: path,
  }
}

// --- LUM-590: project action-rule predicates ----------------------------------

/**
 * Resolve the project context needed to load the compiled policy for a task.
 * Returns { projectId, workspaceId, fullName } or null when either the task is
 * absent or the project has no default linked repository.
 * LUM-483 compliant: delegates to repositories, no prisma.* here.
 */
async function resolveProjectContext(task: {
  projectId: string
  project: { workspaceId: string }
}): Promise<{
  projectId: string
  workspaceId: string
  fullName: string
} | null> {
  const defaultRepo = await projectRepository.findDefaultRepository(
    task.projectId
  )
  if (!defaultRepo) return null
  return {
    projectId: task.projectId,
    workspaceId: task.project.workspaceId,
    fullName: defaultRepo.fullName,
  }
}

/**
 * Pure helper (LUM-590): test a set of compiled PolicyRules against a hook
 * event's command and return any crossings. Only deterministic action rules
 * with a cmd-substr predicate are handled here — path-glob action predicates
 * are handled by the code pipeline. No I/O — safe to unit-test exhaustively.
 *
 * v1 semantics: a project-specific predicate (blocking === false) produces an
 * ADVISORY crossing; a mapped built-in (blocking === true) would produce a
 * standard crossing, but in practice blocking rules always go through the
 * existing built-in matchers above.
 */
export function detectProjectActionCrossings(
  input: { toolName: string | null; payload: unknown },
  rules: PolicyRule[]
): DetectedCrossing[] {
  const command = readCommand(input.payload)
  if (!command) return []
  const out: DetectedCrossing[] = []
  for (const r of rules) {
    if (r.kind !== 'action' || r.tier !== 'deterministic' || !r.predicate)
      continue
    const p = r.predicate
    // path-glob action predicates are handled by the code pipeline — skip here.
    // LUM-751: segment-scoped + prose-stripped (lib/boundary-crossing/
    // action-rule-match) — a read-only / PR-target reference or a quoted
    // keyword no longer counts as a violation.
    // LUM-772: a push prohibition compiles to `push-target` and is judged on
    // the push's OWN destination (a feature push next to `gh pr create --base
    // main` is not a push to main).
    const hit =
      p.type === 'cmd-substr'
        ? matchActionRule(p.value, command)
        : p.type === 'push-target'
          ? matchPushTarget(p.value, command)
          : false
    if (!hit) continue
    out.push({
      category: 'PROJECT_RULE_VIOLATION',
      detail: clip(command),
      severity: r.severity,
      target: `actionrule:${r.id}`,
      advisory: !r.blocking,
      policyRuleRef: r.id,
      policyRuleText: r.text,
    })
  }
  return out
}

/**
 * LUM-923: true only when the task is positively found in the trash. An
 * unknown task, or a failed lookup, reads false so detection still records
 * (fail open: visibility over silence).
 */
async function isTaskInTrash(taskId: string): Promise<boolean> {
  try {
    return (await taskRepository.isTrashed(taskId)) === true
  } catch {
    return false
  }
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
      // LUM-923: a task in the trash collects no new crossings.
      if (await isTaskInTrash(input.taskId)) return
      const crossings = detectCrossings(input)
      // LUM-466: confirm action-category candidates — drop a forbidden token that
      // matched only as prose (commit message / PR body / echo), keep real
      // executed actions and anything the best-effort LLM can't clear.
      const confirmed = await confirmActionCandidates(input, crossings)
      const tampering = await detectTestTamperingForTask(input)
      if (tampering) confirmed.push(tampering)

      // LUM-590: load the project policy best-effort and append any project
      // action-rule crossings. Wrapped in try/catch per the exit-0 invariant —
      // the detector must never throw even if the compiler is unavailable.
      // LUM-751: the task's projectId is captured on the way (for suppression
      // rules) — it is known even when the project has no default repository.
      let projectRules: PolicyRule[] = []
      let projectId: string | null = null
      try {
        const task = await taskRepository.findWithProjectWorkspaceId(
          input.taskId
        )
        projectId = task?.projectId ?? null
        const ctx = task ? await resolveProjectContext(task) : null
        if (ctx) {
          const { policyCompilerService } =
            await import('@/lib/services/policy/policy-compiler.service')
          const compiled = await policyCompilerService.ensureCompiled({
            projectId: ctx.projectId,
            workspaceId: ctx.workspaceId,
            fullName: ctx.fullName,
            taskId: input.taskId,
          })
          projectRules = compiled?.rules ?? []
        }
      } catch {
        // observer: never throw, project path is best-effort
      }
      const projectCrossings = detectProjectActionCrossings(
        { toolName: input.toolName, payload: input.payload },
        projectRules
      )
      confirmed.push(...projectCrossings)
      // LUM-736: sensitive-path edit — the project's path-glob override (if the
      // compiled policy carries one) replaces the built-in path set.
      const sensitive = detectSensitivePathEdit({
        toolName: input.toolName,
        filePath: input.filePath,
        sensitivePathGlobs: sensitivePathGlobsFromRules(projectRules),
      })
      if (sensitive) confirmed.push(sensitive)

      // LUM-751: the project's active, human-authored suppression rules.
      // Best-effort — no rules means nothing is suppressed (the safe side).
      let suppressionRules: ActiveSuppressionRule[] = []
      if (projectId) {
        try {
          suppressionRules =
            await crossingSuppressionRuleRepository.findActiveForProject(
              projectId
            )
        } catch {
          // observer: never throw
        }
      }

      for (const c of confirmed) {
        // LUM-477: coalesce a recurrence of an OPEN crossing with the same
        // (taskId, category, target) — bump its count/lastSeenAt instead of
        // inserting a duplicate row + a duplicate timeline marker. A return of 0
        // means no open match (first occurrence, distinct target/category, or a
        // prior match already dispositioned) → record a fresh crossing. A
        // post-disposition recurrence is therefore never silently swallowed.
        // LUM-751: a human-authored repository rule for this (category, target)
        // → still RECORDED, but system-dispositioned AUTO_SUPPRESSED (no human
        // actor, rule ref), coalescing with its own suppressed row. Never for
        // the HIGH classes (findSuppressionRule refuses them) and never for an
        // evasion-decoded crossing (deliberate obfuscation stays open).
        const rule = isEvasionDecoded(c.detail)
          ? null
          : findSuppressionRule(suppressionRules, c.category, c.target)
        if (rule) {
          const merged =
            await boundaryCrossingRepository.coalesceSuppressedRecurrence(
              input.taskId,
              c.category,
              c.target,
              rule.id,
              new Date()
            )
          if (merged > 0) continue
        }
        const coalesced = await boundaryCrossingRepository.coalesceRecurrence(
          input.taskId,
          c.category,
          c.target,
          new Date(),
          // LUM-779: never coalesce across the advisory line.
          c.advisory ?? false
        )
        if (coalesced > 0) continue
        // LUM-478: a deterministic high-confidence legit TEST_TAMPERING edit is
        // recorded for audit but auto-resolved with the system AUTO_LEGIT
        // disposition — no human actor, out of the open queue (the gate and the
        // CLI both key on `disposition: null`), and non-DONE-blocking. This is a
        // server-internal detector decision, NOT the human-only disposition API
        // (which stays 403-before-parse): an agent still cannot clear any crossing.
        const row = await boundaryCrossingRepository.create({
          taskId: input.taskId,
          hookEventId: input.hookEventId ?? null,
          category: c.category,
          detail: c.detail,
          target: c.target,
          reversible: isReversible(c.category, c.target),
          severity: c.severity,
          ...(c.advisory != null ? { advisory: c.advisory } : {}),
          ...(c.policyRuleRef != null
            ? { policyRuleRef: c.policyRuleRef }
            : {}),
          ...(c.policyRuleText != null
            ? { policyRuleText: c.policyRuleText }
            : {}),
          ...(rule
            ? {
                disposition: 'AUTO_SUPPRESSED',
                dispositionNote: autoSuppressedNote(rule),
                dispositionedAt: new Date(),
                suppressionRuleId: rule.id,
              }
            : c.autoResolve
              ? {
                  disposition: 'AUTO_LEGIT',
                  dispositionNote: AUTO_LEGIT_NOTE,
                  dispositionedAt: new Date(),
                }
              : {}),
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
            // Audit marker: an auto-resolved crossing reads as auto-resolved on
            // the timeline, never as an open one a human still owes a decision on.
            ...(rule
              ? { disposition: 'AUTO_SUPPRESSED', suppressionRuleId: rule.id }
              : c.autoResolve
                ? { disposition: 'AUTO_LEGIT' }
                : {}),
          },
        })
      }
      // LUM-511 Phase 4: silent-fix detection (post-submission edit with no
      // recorded send-back). Separate from the crossing loop — it records a
      // task-level marker, not a crossing.
      await recordSilentFixIfDetected(input)
    } catch (error) {
      // Observe-only: a detector failure must never disrupt ingestion.
      console.error('boundaryDetectorService.detectAndRecord error:', error)
    }
  },

  /**
   * LUM-640 detector backstop for STEWARD (governance) sessions. The API gate
   * blocks `verify` and self-dispatch, but it cannot see file edits or local
   * git — so when a task-less hook event arrives, this checks whether the
   * session is a milestone-bound steward and whether the Bash command produced
   * an implementation artifact (git commit / PR creation). A match records a
   * STEWARD_IMPLEMENTATION_ARTIFACT crossing against the MILESTONE (taskId
   * null, sessionId + hookEventId attribution).
   *
   * Fail-closed on what it cannot confirm: a Bash event in a steward session
   * whose payload yields no readable command is recorded as an UNCONFIRMED
   * crossing rather than skipped — uncertainty is surfaced, not swallowed.
   * Best-effort like detectAndRecord: it owns its errors and never throws.
   * Disposition stays web + human-only — there is no CLI clear path and this
   * recorder never writes a disposition.
   */
  async detectAndRecordStewardArtifact(input: {
    sessionId: string | null
    hookEventId?: string | null
    toolName: string | null
    payload: unknown
  }): Promise<void> {
    try {
      if (!input.sessionId) return
      // Commits/PRs are produced through Bash — other tools have no artifact
      // to classify here (file edits alone are not a commit).
      if (input.toolName !== 'Bash') return
      const steward = await sessionRepository.findStewardBinding(
        input.sessionId
      )
      if (!steward) return

      const cmd = readCommand(input.payload)
      let category_target: string
      let detail: string
      if (cmd == null) {
        // Fail-closed: a steward-session Bash event we cannot parse is
        // "unconfirmed", never "nothing happened".
        category_target = 'unconfirmed'
        detail =
          'Bash activity during a STEWARD (governance) session could not be parsed — implementation-artifact detection is unconfirmed (fail-closed)'
      } else {
        const artifact = detectStewardImplementationArtifact(cmd)
        if (!artifact) return
        category_target = artifact.kind
        detail = `implementation artifact produced during a STEWARD (governance) session for milestone "${steward.milestoneName}": ${clip(artifact.segment)}`
      }

      const now = new Date()
      const coalesced =
        await boundaryCrossingRepository.coalesceRecurrenceForMilestone(
          steward.milestoneId,
          'STEWARD_IMPLEMENTATION_ARTIFACT',
          category_target,
          now
        )
      if (coalesced > 0) return
      await boundaryCrossingRepository.create({
        taskId: null,
        milestoneId: steward.milestoneId,
        sessionId: input.sessionId,
        hookEventId: input.hookEventId ?? null,
        category: 'STEWARD_IMPLEMENTATION_ARTIFACT',
        detail,
        target: category_target,
        reversible: isReversible('STEWARD_IMPLEMENTATION_ARTIFACT'),
        severity: severityFor('STEWARD_IMPLEMENTATION_ARTIFACT'),
      })
      // No TaskActivity mirror: there is no task to attach a timeline marker to.
    } catch (error) {
      // Observe-only: a detector failure must never disrupt ingestion.
      console.error(
        'boundaryDetectorService.detectAndRecordStewardArtifact error:',
        error
      )
    }
  },
}
