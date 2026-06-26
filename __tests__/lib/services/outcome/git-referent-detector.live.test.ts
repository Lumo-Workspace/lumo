import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import {
  detectGitRejections,
  deriveDetectorVerdict,
} from '@/lib/services/outcome/git-referent-detector'

/**
 * LUM-604 — reproducible LIVE-GIT checkpointer for the LUM-601 outcome-well
 * git-topology detector (the LUM-598 falsifier oracle).
 *
 * The LUM-601 unit suite anchors every case on an injected fake runner with a
 * canned routing table — AGENT_CONSTRUCTED input. The detector's real path,
 * which actually shells `git log` / `git show` against a live checkout, was only
 * ever validated once by a throwaway harness. This suite fixes that gap: it is
 * an EXTERNAL_FACT checkpointer that drives the SAME detector with its DEFAULT
 * runner — real git, no injected stub, no frozen fixture — so the verdict is
 * anchored to live commit topology, not to anything this test (or any agent)
 * could fabricate.
 *
 * Two anti-corruption guarantees (otherwise this degrades into a sixth kind of
 * dirty — a live-flavored fake):
 *
 *   ① NO FROZEN FIXTURE. The reverted deliveries are DISCOVERED from live git
 *      at run time, then the detector is re-run over each and cross-checked
 *      against that independent discovery. A revert that lands after LUM-587 is
 *      caught with zero code change — it simply appears in the discovered set.
 *      A pre-captured fixture could not track live state, so it could not pass.
 *
 *   ② TOPOLOGY, NOT WORDING (573 red line). REJECTED is decided by the
 *      `This reverts commit <sha>` backreference whose sha is the delivery's
 *      object id — never by the word "revert" in any message. The negative case
 *      drives the detector over a commit whose own subject literally says
 *      "Revert" yet which nothing back-references, and asserts INCONCLUSIVE.
 *
 * FAIL-CLOSED, never skip: an EXTERNAL_FACT you cannot reach is *unconfirmed*,
 * and unconfirmed is never read as a pass (LUM-604 red line). If the referent
 * is unreachable (no origin/main, shallow clone), the precondition THROWS with
 * remediation rather than silently skipping. This suite therefore requires a
 * full checkout with origin/main fetched — the same constraint the detector
 * itself carries (it runs only where a checkout exists).
 */

// Real-history referent: the LUM-587 (#715) squash commit was reverted by
// aee920c6, whose body carries git's machine-written `This reverts commit …`
// backreference. Both are immutable object ids on origin/main.
const LUM_587_DELIVERY = '7930b19b84ca2e1e409f056a51255627103d12e2'
const LUM_587_REVERT = 'aee920c669b44aa3875327574304067e353bf219'

/** Real git read — stdout as utf-8. The whole point: no canned output. */
function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/** Live ancestry probe against origin/main (false if the ref is unreachable). */
function isAncestorOfMain(sha: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Fail-closed precondition. Exported so its contract can be unit-tested with an
 * injected probe (testing the GUARD's behavior, not constructing a verdict):
 * throw — never skip/pass — when the external referent cannot be confirmed.
 */
export function requireLiveReferent(
  deliverySha: string,
  isAncestor: (sha: string) => boolean
): void {
  if (!isAncestor(deliverySha)) {
    throw new Error(
      `LUM-604 live referent unreachable: the LUM-587 squash ${deliverySha.slice(0, 8)}… must be an ancestor of origin/main. ` +
        'Run from a full checkout with origin/main fetched. Do NOT skip — an unreachable external fact is unconfirmed, never a pass.'
    )
  }
}

const RS = '\x1e' // record separator between commits
const FS = '\x1f' // field separator between %H and %b

/**
 * Discover, from LIVE git, every formal revert on origin/main whose reverted
 * commit is itself reachable (so the detector can range over it). No fixtures —
 * this re-derives the truth the detector is checked against, straight from the
 * repository, every run.
 */
function discoverAncestralReverts(): Array<{
  revertingSha: string
  revertedSha: string
}> {
  const out = git([
    'log',
    'origin/main',
    '-F',
    '--grep',
    'This reverts commit',
    `--format=%H${FS}%b${RS}`,
  ])
  const found: Array<{ revertingSha: string; revertedSha: string }> = []
  for (const chunk of out.split(RS)) {
    const [sha, body = ''] = chunk.split(FS)
    const revertingSha = sha?.trim()
    if (!revertingSha) continue
    for (const m of body.matchAll(/This reverts commit ([0-9a-f]{40})/g)) {
      const revertedSha = m[1]!
      if (isAncestorOfMain(revertedSha))
        found.push({ revertingSha, revertedSha })
    }
  }
  return found
}

describe('outcome-well git detector — LIVE git EXTERNAL_FACT checkpointer LUM-604', () => {
  beforeAll(() => {
    requireLiveReferent(LUM_587_DELIVERY, isAncestorOfMain)
  })

  it('live REJECTED for the real LUM-587 delivery via real git shell discovered not fixtured', () => {
    const reverts = discoverAncestralReverts()

    // Anchor: the LUM-587 revert is present in the live-discovered set — proves
    // the discovery (and thus the detector it feeds) is exercising real history.
    expect(reverts).toContainEqual({
      revertingSha: LUM_587_REVERT,
      revertedSha: LUM_587_DELIVERY,
    })

    // Every live-discovered revert independently drives the detector (default,
    // real-shell runner) to REJECTED, and the detector's reverting sha matches
    // the independent live-git discovery. This cross-check is exactly what a
    // frozen fixture cannot satisfy: both sides are recomputed from live state.
    for (const { revertingSha, revertedSha } of reverts) {
      const signals = detectGitRejections({
        identifier: 'live',
        shas: [revertedSha],
      })
      expect(deriveDetectorVerdict(signals)).toBe('REJECTED')
      expect(
        signals.some(
          s =>
            s.kind === 'REVERTED' &&
            s.mechanism === 'revert-commit' &&
            s.revertingSha === revertingSha &&
            s.revertedSha === revertedSha
        )
      ).toBe(true)
    }
  })

  it('live REJECTED decided by sha-backreference topology not message wording', () => {
    // aee920c6 is ITSELF a `Revert "…"` commit, and further `Revert`-subject
    // commits sit after it on origin/main — yet nothing carries a `This reverts
    // commit aee920c6…` backreference, so topology says INCONCLUSIVE. The word
    // "revert" appearing in the range never manufactures a rejection signal.
    const signals = detectGitRejections({
      identifier: 'unreverted',
      shas: [LUM_587_REVERT],
    })
    expect(signals).toEqual([])
    expect(deriveDetectorVerdict(signals)).toBe('INCONCLUSIVE')
  })

  it('live suite shells real git and fails closed not a frozen fixture', () => {
    // Structural anti-corruption invariant: this checkpointer must keep anchoring
    // to EXTERNAL_FACT live git and never regress into a live-flavored fake.
    const src = readFileSync(__filename, 'utf8')

    // Real shell, not canned output — the suite execs git directly.
    expect(src).toContain("execFileSync('git'")
    // Fail-closed guard is present.
    expect(src).toContain('throw new Error')
    // No injected fake runner stub typed as the detector's runner. The token is
    // assembled here so it never appears literally in this file's source.
    const fakeRunnerToken = ['Git', 'Runner'].join('')
    expect(src).not.toContain(fakeRunnerToken)

    // …and the guard genuinely THROWS when the referent cannot be confirmed —
    // never a silent skip/pass — yet stays out of the way when it is reachable.
    expect(() => requireLiveReferent(LUM_587_DELIVERY, () => false)).toThrow(
      /unreachable/
    )
    expect(() =>
      requireLiveReferent(LUM_587_DELIVERY, () => true)
    ).not.toThrow()
  })
})
