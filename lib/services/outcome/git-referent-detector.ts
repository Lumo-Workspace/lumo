import { execFileSync } from 'child_process'
import {
  OUTCOME_VERDICTS,
  type OutcomeVerdict,
} from '@/lib/services/outcome/verdict'

/**
 * LUM-601 — two automatic referent signal sources for the post-hoc outcome well
 * (the LUM-598 falsifier oracle). Both read facts the agent cannot construct:
 * git commit topology AFTER a delivery shipped.
 *
 *   1. revert-commit detection — a later commit reverts the delivery, identified
 *      by git's own machine-written `This reverts commit <sha>` backreference to
 *      the delivery's object id (not by any PR/commit prose).
 *   2. downstream content-reversal detection — a later commit's diff reverses the
 *      delivery's, identified by reverse patch-id equality (topology, not
 *      wording). Catches hand-reverts that carry no trailer.
 *
 * 573 RED LINE: every signal is decided by commit topology — an immutable object
 * id backreference or a patch-id — never by what a commit message / PR claims.
 * A commit that merely *says* "revert" produces no signal.
 *
 * KNOWN-UNCOVERED (registered, not faked as "well is full"):
 *   - CI rollback / deploy rollback — needs a CI webhook (OutcomeSignalSource.CI),
 *     a larger dig; not wired here.
 *   - PARTIAL reversals — patch-id matches only an EXACT full reversal; a commit
 *     that reverts most-but-not-all of a delivery is not flagged (precision over
 *     recall: a falsifier must never cry REJECTED on a guess).
 *   - This detector reads git, so it runs only where a checkout exists (CLI /
 *     CI / operational script) — never the serverless server cron.
 */

/** A git read. `input` is fed on stdin (for `git patch-id`). Injected in tests. */
export type GitRunner = (file: string, args: string[], input?: string) => string

const defaultRun: GitRunner = (file, args, input) =>
  execFileSync(file, args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
    ...(input !== undefined ? { input } : {}),
  })

export type GitRejectionMechanism = 'revert-commit' | 'patch-reversal'

export interface GitRejectionSignal {
  /** REVERTED for a formal revert; DOWNSTREAM_REDIRECT for a content reversal. */
  kind: 'REVERTED' | 'DOWNSTREAM_REDIRECT'
  mechanism: GitRejectionMechanism
  /** The later commit that undid the delivery. */
  revertingSha: string
  /** The delivery commit it undid. */
  revertedSha: string
}

export interface DeliveryRef {
  identifier: string
  /**
   * The delivery's commit sha(s) on origin/main (≥1). For a squash-merge
   * workflow this is the single PR merge commit. The scan covers commits
   * reachable from origin/main but NOT from any of these (i.e. strictly after).
   */
  shas: string[]
}

/** Cap on downstream commits scanned for patch-id reversal — bounds git cost on
 *  long-lived branches. When hit, detection is reported partial (onTruncate),
 *  never silently truncated. */
export const DOWNSTREAM_SCAN_CAP = 500

const TRAILER_RE = /This reverts commit ([0-9a-f]{40})/g
const RS = '\x1e' // record separator between commits
const FS = '\x1f' // field separator between %H and %b

/** First whitespace-delimited token of `git patch-id` output, or null. */
function parsePatchId(out: string): string | null {
  const tok = out.trim().split(/\s+/)[0]
  return tok && tok.length > 0 ? tok : null
}

/**
 * Detector 1 — formal reverts. Scan commits after the delivery for a
 * `This reverts commit <sha>` trailer whose <sha> is one of the delivery's. The
 * trailer is git's own structural backreference to an object id; the `--grep`
 * only narrows candidates — the SIGNAL is the sha-membership test.
 */
function detectRevertCommits(
  shas: string[],
  shaSet: Set<string>,
  run: GitRunner
): GitRejectionSignal[] {
  const out = run('git', [
    'log',
    'origin/main',
    ...shas.map(s => `^${s}`),
    '-F',
    '--grep',
    'This reverts commit',
    `--format=%H${FS}%b${RS}`,
  ])
  const signals: GitRejectionSignal[] = []
  for (const chunk of out.split(RS)) {
    const [rawSha, body = ''] = chunk.split(FS)
    const revertingSha = rawSha?.trim()
    if (!revertingSha) continue
    for (const m of body.matchAll(TRAILER_RE)) {
      const revertedSha = m[1]!
      if (shaSet.has(revertedSha)) {
        signals.push({
          kind: 'REVERTED',
          mechanism: 'revert-commit',
          revertingSha,
          revertedSha,
        })
        break
      }
    }
  }
  return signals
}

/** Files the delivery touched (union across its commits). */
function deliveryChangedFiles(shas: string[], run: GitRunner): string[] {
  const files = new Set<string>()
  for (const sha of shas) {
    let numstat = ''
    try {
      numstat = run('git', ['show', sha, '--numstat', '--format='])
    } catch {
      continue
    }
    for (const line of numstat.split('\n')) {
      const m = line.match(/^(?:\d+|-)\t(?:\d+|-)\t(.+)$/)
      if (m?.[1]) files.add(m[1])
    }
  }
  return [...files]
}

/**
 * Detector 2 — downstream content reversal. A commit that reverse-applies the
 * delivery has a patch-id equal to the patch-id of the delivery's REVERSED diff
 * (`git diff <sha> <sha>^`). We compute that reverse patch-id per delivery
 * commit, then scan downstream commits that touch the delivery's files for a
 * patch-id match. Exact-match only — partial reversals are deliberately not
 * flagged (see KNOWN-UNCOVERED).
 */
function detectPatchReversals(
  shas: string[],
  shaSet: Set<string>,
  alreadyReverting: Set<string>,
  run: GitRunner,
  onTruncate?: (scanned: number, total: number) => void
): GitRejectionSignal[] {
  // reverse patch-id → the delivery sha it reverses
  const reversePidToSha = new Map<string, string>()
  for (const sha of shas) {
    try {
      const revDiff = run('git', ['diff', sha, `${sha}^`])
      if (!revDiff.trim()) continue
      const pid = parsePatchId(run('git', ['patch-id', '--stable'], revDiff))
      if (pid) reversePidToSha.set(pid, sha)
    } catch {
      // root commit (no parent) or unreadable — no reverse signal from it.
    }
  }
  if (reversePidToSha.size === 0) return []

  const files = deliveryChangedFiles(shas, run)
  if (files.length === 0) return []

  const candidateOut = run('git', [
    'log',
    'origin/main',
    ...shas.map(s => `^${s}`),
    '--format=%H',
    '--',
    ...files,
  ])
  let candidates = candidateOut
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(c => !alreadyReverting.has(c) && !shaSet.has(c))

  if (candidates.length > DOWNSTREAM_SCAN_CAP) {
    onTruncate?.(DOWNSTREAM_SCAN_CAP, candidates.length)
    candidates = candidates.slice(0, DOWNSTREAM_SCAN_CAP)
  }

  const signals: GitRejectionSignal[] = []
  for (const cand of candidates) {
    let pid: string | null = null
    try {
      const diff = run('git', ['show', '--format=', cand])
      if (!diff.trim()) continue
      pid = parsePatchId(run('git', ['patch-id', '--stable'], diff))
    } catch {
      continue
    }
    const revertedSha = pid ? reversePidToSha.get(pid) : undefined
    if (revertedSha) {
      signals.push({
        kind: 'DOWNSTREAM_REDIRECT',
        mechanism: 'patch-reversal',
        revertingSha: cand,
        revertedSha,
      })
    }
  }
  return signals
}

/**
 * Run both detectors over a delivery and return every git-topology rejection
 * signal. A formal revert (caught by detector 1) is NOT re-counted by detector 2
 * even though its patch-id also matches — one mechanism, one signal.
 */
export function detectGitRejections(
  delivery: DeliveryRef,
  run: GitRunner = defaultRun,
  onTruncate?: (scanned: number, total: number) => void
): GitRejectionSignal[] {
  const shas = delivery.shas.filter(Boolean)
  if (shas.length === 0) return []
  const shaSet = new Set(shas)

  const reverts = detectRevertCommits(shas, shaSet, run)
  const reverting = new Set(reverts.map(s => s.revertingSha))
  const reversals = detectPatchReversals(
    shas,
    shaSet,
    reverting,
    run,
    onTruncate
  )
  return [...reverts, ...reversals]
}

/**
 * The detector's verdict, drawn from the well's shared two-member space. REJECTED
 * iff ≥1 git rejection signal; otherwise INCONCLUSIVE. There is no SATISFIED/PASS
 * — absence of a rejection is never upgraded to a pass.
 */
export function deriveDetectorVerdict(
  signals: GitRejectionSignal[]
): OutcomeVerdict {
  const verdict: OutcomeVerdict =
    signals.length > 0 ? 'REJECTED' : 'INCONCLUSIVE'
  // Defensive: guarantee membership in the shared space.
  return OUTCOME_VERDICTS.includes(verdict) ? verdict : 'INCONCLUSIVE'
}
