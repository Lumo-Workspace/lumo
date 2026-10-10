import type { BoundaryCrossingCategory } from '@prisma/client'
// LUM-779: single-sourced with the CLI's local-git probe — see the module doc.
import { TEST_FILE_TARGET } from '../../shared/src/test-file-path'
import {
  CHECKOUT_RELATIVE_PATH_FIELD,
  WRITTEN_PATH_IGNORED_FIELD,
  WRITTEN_PATH_PROBE_FIELD,
  WRITTEN_PATH_PROBE_FILE_DIR,
} from '../../shared/src/written-path-probe'
import { applyPatchText, parseApplyPatch } from '../../shared/src/apply-patch'
import {
  isCrossingAdvisoryRule,
  isShapeRule,
} from '@/lib/security-scan/secret-patterns'
import { scanSecrets } from '@/lib/security-scan/scan-secrets'
import type {
  RawSecretFinding,
  SecuritySeverity,
} from '@/lib/security-scan/core-types'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { parseChildSessionId } from '@/lib/session/child-session-id'
import { WRITE_TOOLS } from '@/lib/constants/hook-tools'
import { matchPathGlob } from '@/lib/policy/path-glob'
import type { PolicyRule } from '@/lib/policy/types'
import {
  splitCommandSegments as splitCommandSegmentsShared,
  executingSegments,
} from '@/lib/boundary-crossing/command-shape'
import { matchNewDependency } from '@/lib/boundary-crossing/install-sources'
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
import { logger } from '@/lib/logger'
import type {
  BoundaryDetectionInput,
  DetectedCrossing,
} from '@/lib/boundary-crossing/detection-types'
import {
  clip,
  isApplyPatch,
  readCommand,
} from '@/lib/boundary-crossing/detection-input'
import { isReversible, severityFor } from '@/lib/boundary-crossing/taxonomy'
import { sensitivePathGlobsFromRules } from '@/lib/boundary-crossing/policy-rule-paths'
import { forbiddenRuleSourceService } from '@/lib/services/forbidden-rule-source.service'
import {
  pluginCrossingDetectors,
  policyRuleSource,
} from '@/lib/plugins/crossings'
import type {
  CrossingCommandMatcher,
  CrossingConfirmJudge,
  CrossingDetectionEvent,
  CrossingDetector,
} from '@/lib/plugins/crossing-types'

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
 *
 * LUM-1063 (RFC LUM-1058 §2.2, PR4): this module is the MIT core's detection
 * PIPELINE plus its BASELINE detectors — the deterministic classes bound to
 * Lumo's task / DONE flow (protected push, migration / test-file delete,
 * destructive DB, new dependency, the action classes' matchers, hook bypass,
 * hard-coded secrets, sensitive-path edits, steward artifacts) and the base64
 * evasion pass. The advanced detectors (destructive-fs, untrusted-code,
 * sensitive reads), the LLM prose confirmation and the compiled project
 * policy rules are registered by a plugin (`lib/plugins/crossing-types.ts`);
 * without one, the action classes are recorded without the confirmation.
 */

// LUM-1063: moved to pure core modules; re-exported so every caller keeps
// importing them from here.
export type { BoundaryDetectionInput, DetectedCrossing }
export { isClippedDetail } from '@/lib/boundary-crossing/detection-input'
export { isReversible, severityFor } from '@/lib/boundary-crossing/taxonomy'
export {
  sensitivePathGlobsFromRules,
  sensitiveReadRulesFromRules,
} from '@/lib/boundary-crossing/policy-rule-paths'

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
 * `edits[].new_string` / NotebookEdit `new_source`, LUM-904; Codex
 * `apply_patch` added lines, LUM-1051) for secret scanning.
 */
function readWrittenContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  if (isApplyPatch(payload)) {
    const text = applyPatchText(input)
    const added = text === null ? '' : parseApplyPatch(text).addedText
    return added !== '' ? added : null
  }
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
 * Installing a NEW dependency — only a segment whose OWN install verb names a
 * registry package. LUM-751: segment-scoped, so `npm install && npm test`, a
 * lockfile sync inside `.worktrees/`, a flag-only install and `npm ci` never
 * trip; a trailing `# comment` is ignored. LUM-770/772: a heredoc body is
 * authored text, never an install. LUM-957: redirections and wrapper quotes
 * are not package names. (A lockfile-diff check is the PR scanner's job —
 * LUM-738 — the hook only sees the command.)
 *
 * LUM-962: every ecosystem with the same "names a new package" meaning — pip /
 * uv / pipx / poetry / gem / cargo / go as well as npm / yarn / pnpm / bun. A
 * VCS / URL source is not a "new package" here: it is UNTRUSTED_CODE_EXECUTION.
 * See lib/boundary-crossing/untrusted-code.
 */
function matchNewNpmDependency(cmd: string): boolean {
  return matchNewDependency(cmd)
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
    // LUM-957: `-T` only as its own option token (incl. bundled short flags
    // like `-sT`) — unanchored, it matched inside `-H 'Content-Type: …'`.
    // Only value-less flags may precede it in a bundle: after an argument-taking
    // one (`-XPUT`, `-dToken=…`) the `T` is that flag's value, not an upload.
    // Scoped to curl's own segment so a sibling `kill -TERM` doesn't count;
    // `\`-newline continuations are joined first to keep a wrapped curl whole.
    // The short `-d @file` (incl. `-d@file`, `-d @"$f"`) is scoped the same way
    // — `date -d @<epoch>` in a sibling segment is not an upload.
    const curlUploadFlag = /(?:^|[\s'"])-[sSLfkvigGINnq]*T/
    const curlDataFromFile = /(?:^|[\s'"])-[sSLfkvigGINnq]*d\s*['"]?@/
    if (
      splitCommandSegmentsShared(cmd.replace(/\\\r?\n/g, ' ')).some(
        seg =>
          /\bcurl\b/.test(seg) &&
          (curlUploadFlag.test(seg) || curlDataFromFile.test(seg))
      )
    )
      return true
    if (/(?:--upload-file|-F\s+\S*@|--form\s+\S*@)/.test(cmd)) return true
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
 * referencing a test) does not trip.
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

/** The core's command-shaped matchers (baseline), paired with their category —
 *  single source for both detection (matchCommand) and the coalescing
 *  fingerprint below. */
const CORE_COMMAND_MATCHERS: ReadonlyArray<CrossingCommandMatcher> = [
  { category: 'PUSH_TO_PROTECTED_BRANCH', fn: matchProtectedPush },
  { category: 'MIGRATION_FILE_DELETED', fn: matchMigrationDelete },
  { category: 'DESTRUCTIVE_DB_COMMAND', fn: matchDestructiveDb },
  { category: 'NEW_NPM_DEPENDENCY', fn: matchNewNpmDependency },
  // LUM-1063: the action classes are core matchers; a plugin may add the
  // LUM-466 prose confirmation on top (without it they are recorded as is).
  { category: 'EXFILTRATION_PUBLIC', fn: matchExfiltrationPublic },
  { category: 'CLOUD_DATA_DELETION', fn: matchCloudDataDeletion },
  { category: 'INFRA_TERMINATION', fn: matchInfraTermination },
  // LUM-736 L4 Session Guard (segment-scoped; prose-confirmed via LUM-466).
  { category: 'HOOK_BYPASS', fn: matchHookBypass },
  { category: 'TEST_FILE_DELETED', fn: matchTestFileDelete },
]

/**
 * LUM-1063: the order the command matchers run in — and so the order their
 * crossings are reported and recorded in. It keeps a slot for the
 * command-shaped categories a plugin registers (LUM-960 destructive-fs,
 * LUM-962 untrusted code), so installing the plugin reproduces the pre-split
 * order exactly. A plugin matcher for a category not listed here runs last.
 */
const COMMAND_CATEGORY_ORDER: ReadonlyArray<BoundaryCrossingCategory> = [
  'PUSH_TO_PROTECTED_BRANCH',
  'MIGRATION_FILE_DELETED',
  'DESTRUCTIVE_DB_COMMAND',
  'NEW_NPM_DEPENDENCY',
  'EXFILTRATION_PUBLIC',
  'CLOUD_DATA_DELETION',
  'INFRA_TERMINATION',
  'DESTRUCTIVE_FS_COMMAND',
  'UNTRUSTED_CODE_EXECUTION',
  'HOOK_BYPASS',
  'TEST_FILE_DELETED',
]

/** The core matchers plus every plugin detector's, in COMMAND_CATEGORY_ORDER. */
function installedCommandMatchers(): CrossingCommandMatcher[] {
  const all = [
    ...CORE_COMMAND_MATCHERS,
    ...pluginCrossingDetectors().flatMap(d => d.commandMatchers ?? []),
  ]
  const rank = (c: BoundaryCrossingCategory) => {
    const i = COMMAND_CATEGORY_ORDER.indexOf(c)
    return i < 0 ? COMMAND_CATEGORY_ORDER.length : i
  }
  // Array.prototype.sort is stable: same-category matchers keep their order.
  return all.sort((a, b) => rank(a.category) - rank(b.category))
}

/** The command-shaped categories the installed matchers cover, for parity
 *  guards in tests (LUM-772). LUM-1063: depends on the installed plugins. */
export function commandMatcherCategories(): BoundaryCrossingCategory[] {
  return installedCommandMatchers().map(m => m.category)
}

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
  for (const { category, fn, raw } of installedCommandMatchers()) {
    if (!fn(raw ? cmd : executing)) continue
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
 *
 * LUM-1063: runs the installed detectors — the core baseline plus whatever a
 * plugin registered (its command matchers join the literal and evasion
 * passes; its `detect` runs after the secret scan).
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

  // LUM-1063: the plugin detectors' event-level checks (e.g. LUM-963 reads of
  // a credential store). A throw drops only that detector's part.
  const event = detectionEvent(input, cmd)
  for (const d of pluginCrossingDetectors()) {
    if (!d.detect) continue
    try {
      out.push(...d.detect(event))
    } catch (error) {
      logDetectorFailure(d, 'detect', error)
    }
  }

  return out
}

function detectionEvent(
  input: Pick<BoundaryDetectionInput, 'toolName' | 'filePath' | 'payload'>,
  command: string | null = readCommand(input.payload)
): CrossingDetectionEvent {
  return {
    toolName: input.toolName,
    filePath: input.filePath,
    payload: input.payload,
    command,
  }
}

function logDetectorFailure(
  d: CrossingDetector,
  hook: string,
  error: unknown
): void {
  logger.error(
    `[boundary-detector] plugin detector ${d.id}.${hook} failed:`,
    error instanceof Error ? error.message : String(error)
  )
}

/** The categories the installed command matchers find on `cmd` (literal pass,
 *  no evasion decode) — the confirmation step's "still matches" test. */
function commandCategories(cmd: string): Set<BoundaryCrossingCategory> {
  return new Set(matchCommand(cmd, false).map(c => c.category))
}

/**
 * The confirmation step (LUM-466) over the crossings `detectCrossings`
 * produced: each plugin detector's `confirm`, in registration order. With no
 * plugin — or a confirm that throws — the crossings pass through unchanged:
 * the action classes are recorded without the LLM prose confirmation (more
 * noise, never less recall). `judge` overrides the plugin's own judge
 * (tests, offline eval).
 */
export async function confirmActionCandidates(
  input: {
    payload: unknown
    toolName?: string | null
    filePath?: string | null
  },
  crossings: DetectedCrossing[],
  judge?: CrossingConfirmJudge
): Promise<DetectedCrossing[]> {
  const event = detectionEvent({
    toolName: input.toolName ?? null,
    filePath: input.filePath ?? null,
    payload: input.payload,
  })
  let out = crossings
  for (const d of pluginCrossingDetectors()) {
    if (!d.confirm) continue
    try {
      out = await d.confirm(event, out, {
        commandCategories,
        ...(judge ? { judge } : {}),
      })
    } catch (error) {
      logDetectorFailure(d, 'confirm', error)
    }
  }
  return out
}

/** Every plugin detector's `detectWithRules` for one event. */
function detectWithRules(
  event: CrossingDetectionEvent,
  rules: readonly PolicyRule[]
): DetectedCrossing[] {
  const out: DetectedCrossing[] = []
  for (const d of pluginCrossingDetectors()) {
    if (!d.detectWithRules) continue
    try {
      out.push(...d.detectWithRules(event, rules))
    } catch (error) {
      logDetectorFailure(d, 'detectWithRules', error)
    }
  }
  return out
}

/**
 * LUM-1063: whether an installed detector judges project policy rules at all.
 * Without one, `detectProjectActionCrossings` is `[]` for every command — a
 * caller must not read that as "the rule no longer matches".
 */
export function projectRuleDetectionInstalled(): boolean {
  return pluginCrossingDetectors().some(d => d.detectWithRules != null)
}

/**
 * The crossings the project's compiled ACTION rules raise for an event
 * (LUM-590 PROJECT_RULE_VIOLATION). LUM-1063: the predicates are produced by
 * the plugin's LLM compiler and judged by its detector, so this reads the
 * installed detectors' output — `[]` without a plugin.
 */
export function detectProjectActionCrossings(
  input: { toolName: string | null; payload: unknown },
  rules: PolicyRule[]
): DetectedCrossing[] {
  return detectWithRules(
    detectionEvent({ ...input, filePath: null }),
    rules
  ).filter(c => c.category === 'PROJECT_RULE_VIOLATION')
}

/**
 * The reads a project rule adds for one event (LUM-963; built-in reads come
 * from `detectCrossings`). LUM-1063: a plugin detector's — `[]` without one.
 */
export function detectProjectSensitiveReadCrossings(
  input: Pick<BoundaryDetectionInput, 'toolName' | 'filePath' | 'payload'>,
  rules: PolicyRule[]
): DetectedCrossing[] {
  return detectWithRules(detectionEvent(input), rules).filter(
    c => c.category === 'SENSITIVE_PATH_READ'
  )
}

/** Normalize a path for comparison: forward slashes, no leading `./`. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
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

/** A repo-relative glob must also match the tail of an absolute event path. */
function matchSensitiveGlob(glob: string, path: string): boolean {
  if (matchPathGlob(glob, [path])) return true
  return !glob.startsWith('**') && !glob.startsWith('/')
    ? matchPathGlob(`**/${glob}`, [path])
    : false
}

/**
 * Every file a write event touches: the indexed `filePath`, plus — for a Codex
 * `apply_patch` (LUM-1051) — each file named in the patch headers.
 */
export function writtenFilePaths(input: {
  filePath: string | null
  payload: unknown
}): string[] {
  const paths = input.filePath ? [input.filePath] : []
  if (isApplyPatch(input.payload)) {
    const text = applyPatchText(
      (input.payload as Record<string, unknown>).tool_input
    )
    for (const f of text === null ? [] : parseApplyPatch(text).files) {
      for (const p of [f.path, f.moveTo]) {
        if (p && !paths.includes(p)) paths.push(p)
      }
    }
  }
  return paths
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
      // LUM-1063: a plugin step; without one the candidates are kept as is.
      const confirmed = await confirmActionCandidates(input, crossings)

      // LUM-590: load the project policy best-effort (the plugin's policy rule
      // source compiles CLAUDE.md / AGENTS.md). Wrapped in try/catch per the
      // exit-0 invariant — the detector must never throw even if the compiler
      // is unavailable. LUM-751: the task's projectId is captured on the way
      // (for suppression rules) — it is known even when the project has no
      // default repository.
      let projectRules: PolicyRule[] = []
      let projectId: string | null = null
      let workspaceId: string | null = null
      try {
        const task = await taskRepository.findWithProjectWorkspaceId(
          input.taskId
        )
        projectId = task?.projectId ?? null
        workspaceId = task?.project.workspaceId ?? null
        const source = policyRuleSource()
        if (task && source) {
          projectRules = await source.rulesForTask({
            taskId: input.taskId,
            projectId: task.projectId,
            workspaceId: task.project.workspaceId,
          })
        }
      } catch {
        // observer: never throw, project path is best-effort
      }
      // LUM-1068: the core's deterministic rule source — the `## Forbidden`
      // items of CLAUDE.md / AGENTS.md, no model. Runs with or without the
      // plugin, AFTER its compile above so a removal the plugin just
      // recorded is deduped (one removal = one POLICY_WEAKENING row).
      // Never throws.
      if (projectId && workspaceId) {
        await forbiddenRuleSourceService.observe({
          taskId: input.taskId,
          projectId,
          workspaceId,
        })
      }
      // LUM-736: sensitive-path edit — the project's path-glob override (if the
      // compiled policy carries one) replaces the built-in path set.
      // LUM-1051: an apply_patch can touch several files — check each one.
      const sensitivePathGlobs = sensitivePathGlobsFromRules(projectRules)
      for (const filePath of writtenFilePaths(input)) {
        const sensitive = detectSensitivePathEdit({
          toolName: input.toolName,
          filePath,
          sensitivePathGlobs,
        })
        if (sensitive) confirmed.push(sensitive)
      }
      // LUM-590 / LUM-963: the project rules' own detections (plugin) —
      // PROJECT_RULE_VIOLATION from action predicates, SENSITIVE_PATH_READ
      // from the project's read globs.
      confirmed.push(...detectWithRules(detectionEvent(input), projectRules))

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
              : {}),
          },
        })
      }
    } catch (error) {
      // Observe-only: a detector failure must never disrupt ingestion.
      console.error('boundaryDetectorService.detectAndRecord error:', error)
    }
  },

  /**
   * LUM-640 detector backstop for STEWARD (governance) sessions. The API gate
   * blocks self-dispatch, but it cannot see file edits or local
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
      // LUM-932: a subagent's child session (`<parent>:<agentId>`) carries no
      // role of its own — the steward binding lives on the parent session.
      const bindingSessionId =
        parseChildSessionId(input.sessionId)?.parentSessionId ?? input.sessionId
      const steward =
        await sessionRepository.findStewardBinding(bindingSessionId)
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
