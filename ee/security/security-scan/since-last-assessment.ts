/**
 * LUM-1312 — on a re-assessment, what changed since the previous one: the
 * head that assessment ran on, the diff from it to this head, the test-case
 * runs recorded since, and each requirement's previous outcome. The judge
 * looks there first for the requirements that were unclear or not addressed
 * last time — the new commits and runs are what changed.
 *
 * The previous outcome is context, never evidence: every requirement is
 * still judged on this head's whole diff and evidence, and an earlier
 * "addressed" is never carried forward (the material says so).
 *
 * When the previous head is not an ancestor of this one (a force-push or a
 * rebase) or the compare cannot be read, there is no reliable "since": the
 * section says the assessment is from scratch and carries nothing from the
 * previous one.
 *
 * PURE: which stored record is "the previous assessment", and the lines the
 * model reads. The reads (scan rows, the GitHub compare) live in
 * `pre-merge-checks.service.ts`.
 */
import type { PreMergeChecksRecord } from './pre-merge-checks'
import type { RequirementOutcome } from './issue-assessment'
import type { TestCaseEvidence } from './test-case-evidence'

/** The whole section, at most (its diff is cut first). */
export const SINCE_LAST_MATERIAL_MAX = 6_000
/** The diff since the previous head, at most (after path filters and the mask). */
export const SINCE_LAST_DIFF_MAX = 4_000
/** Stored records read back to find the previous assessment, at most. */
export const SINCE_LAST_RECORDS_MAX = 10

/** The previous assessment of a different head. */
export interface PreviousAssessment {
  headSha: string
  ranAt: string
  outcomes: Array<{ id: string; outcome: RequirementOutcome }>
}

export type SinceLastAssessment =
  | {
      kind: 'since'
      previous: PreviousAssessment
      /** Commits from the previous head to this one (0 = unknown). */
      aheadBy: number
      /** Path-filtered, masked, cut to `SINCE_LAST_DIFF_MAX`. */
      diff: string
      diffFiles: number
      /** Cut by the cap, the mask, or GitHub's file limit. */
      diffCut: boolean
    }
  | {
      kind: 'from_scratch'
      previous: Pick<PreviousAssessment, 'headSha' | 'ranAt'>
      reason: 'not_ancestor' | 'unreadable'
    }

/**
 * PURE — the newest stored assessment of `checkId` on a head other than
 * `headSha` (records newest first, parsed; null entries skipped). A record of this same head is
 * skipped (an edit re-check, or a re-scan); one whose check has no
 * per-requirement outcomes (not applicable, nothing linked) is skipped too.
 */
export function previousAssessment(
  records: ReadonlyArray<PreMergeChecksRecord | null>,
  checkId: string,
  headSha: string
): PreviousAssessment | null {
  for (const record of records) {
    if (!record || !record.headSha || record.headSha === headSha) continue
    const result = record.results.find(r => r.id === checkId)
    if (!result?.requirements?.length) continue
    return {
      headSha: record.headSha,
      ranAt: record.ranAt,
      outcomes: result.requirements.map(r => ({
        id: r.id,
        outcome: r.outcome,
      })),
    }
  }
  return null
}

/**
 * PURE — the cases whose head run was recorded after the previous
 * assessment ran (number order). A run with no recorded time is left out:
 * it cannot be placed after it.
 */
export function runsRecordedSince(
  evidence: TestCaseEvidence | undefined,
  ranAt: string
): number[] {
  const since = Date.parse(ranAt)
  if (!evidence || Number.isNaN(since)) return []
  return evidence.atHead
    .filter(e => e.recordedAt && Date.parse(e.recordedAt) > since)
    .map(e => e.number)
    .sort((a, b) => a - b)
}

function short(sha: string): string {
  return sha.slice(0, 7).replace(/[^0-9a-f]/gi, '')
}

const OUTCOME_WORD: Record<RequirementOutcome, string> = {
  addressed: 'addressed',
  not_addressed: 'not_addressed',
  unclear: 'unclear',
}

/**
 * PURE — the section of the assessment's material (null when there was no
 * previous assessment). Previous outcomes are listed only for the ids being
 * judged now; the diff is the last thing in the section, so the cap cuts it
 * before anything else.
 */
export function sinceLastAssessmentMaterial(
  since: SinceLastAssessment | undefined,
  requirementIds: readonly string[],
  evidence?: TestCaseEvidence
): string | null {
  if (!since) return null
  const prev = short(since.previous.headSha)
  if (since.kind === 'from_scratch')
    return since.reason === 'not_ancestor'
      ? `Since the last assessment: Lumo assessed this pull request before on ${prev}, which is not an ancestor of this head (the branch was force-pushed or rebased), so there is no reliable diff since then. Judge every requirement from scratch on the whole diff and the evidence; nothing from that assessment is carried over.`
      : `Since the last assessment: Lumo assessed this pull request before on ${prev}, but could not read what changed since then. Judge every requirement from scratch on the whole diff and the evidence; nothing from that assessment is carried over.`
  const wanted = new Set(requirementIds)
  const outcomes = since.previous.outcomes.filter(o => wanted.has(o.id))
  const open = outcomes.filter(o => o.outcome !== 'addressed').map(o => o.id)
  const runs = runsRecordedSince(evidence, since.previous.ranAt)
  const lines = [
    `Since the last assessment: Lumo assessed this pull request before on ${prev}${since.aheadBy > 0 ? `; this head is ${since.aheadBy} commit${since.aheadBy === 1 ? '' : 's'} ahead of it` : ''}. ${open.length ? `For the requirements that were unclear or not addressed then (${open.join(', ')}), look first at the changes and the test-case runs below — they are what changed since.` : 'Look first at the changes and the test-case runs below — they are what changed since.'} The previous outcomes are context, never evidence: judge every requirement on this head's whole diff and evidence, and never mark one addressed only because it was addressed before. A requirement that needs a runtime check (a command's exit code, a test suite passing, a screenshot) is still addressed only by a PASS test-case run on this head that performs it — new commits cannot show it, and neither can the pull request description.`,
    ...(outcomes.length
      ? [
          `Previous outcomes (on ${prev}): ${outcomes.map(o => `${o.id}=${OUTCOME_WORD[o.outcome]}`).join(', ')}.`,
        ]
      : []),
    runs.length
      ? `Test-case runs on this head recorded since then (shown with the other runs below): ${runs.map(n => `TC${n}`).join(', ')}.`
      : 'No test-case run on this head was recorded since then.',
  ]
  const head = lines.join('\n')
  if (!since.diff.trim())
    return `${head}\nChanges since ${prev}: none in the reviewed files.`
  const label = (cut: boolean) =>
    `Changes since ${prev} (${since.diffFiles} file${since.diffFiles === 1 ? '' : 's'}${cut ? "; cut to fit — the pull request's whole diff is still the reference" : ''}):`
  // Room for the longer label, so the section stays under its cap either way.
  const room = SINCE_LAST_MATERIAL_MAX - head.length - label(true).length - 2
  if (room <= 0) return head
  const cut = since.diffCut || since.diff.length > room
  return `${head}\n${label(cut)}\n${since.diff.slice(0, room)}`.trimEnd()
}
