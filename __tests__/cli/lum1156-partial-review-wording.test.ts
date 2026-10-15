/**
 * @jest-environment node
 *
 * LUM-1156 — a size-capped partial AI review reads in the CLI the way the PR
 * summary tells it: a limit on the change (which files, how many), never
 * "has not covered every file yet" (unfinished work of ours), and the budget
 * line compares the diff against the size limit, not the internal tier the
 * reviewed part happened to fit in.
 *
 * Specimen: the production probe after LUM-1144 — 305,874 chars over 4
 * reviewable files, one huge data file skipped, the 3 that fit reviewed
 * under the 60,000-char tier.
 */
import {
  formatJudgeBudgetLine,
  scanFields,
  type JudgePartialLine,
} from '@/cli/src/lib/scan-format'

const PARTIAL: JudgePartialLine = {
  reviewedFiles: 3,
  totalFiles: 4,
  capFiles: 150,
  capChars: 180_000,
  skippedPaths: ['data/catalog.json'],
}
const BUDGET = {
  diffChars: 305_874,
  tierChars: 60_000,
  reviewedChars: 612,
  coveredFiles: 3,
  droppedFiles: 1,
}

describe('LUM-1156 partial review wording', () => {
  it('the AI review row names the size limit, not unfinished work', () => {
    const fields = scanFields(
      {
        status: 'PARTIAL',
        stages: { secrets: 'RAN', judge: 'PARTIAL' },
        partial: true,
        partialCauses: ['JUDGE_PARTIAL_OVER_CAP'],
        judgePartial: PARTIAL,
        externalFindings: 0,
        externalFailureReason: null,
      },
      { judgeBudget: BUDGET, truncated: true }
    )
    const judge = fields.find(f => f.label === 'AI review')
    const text = JSON.stringify(fields)
    expect(text).not.toContain('has not covered every file yet')
    expect(judge?.sub).toContain(
      'over the size limit — reviewed 3 of 4 reviewable files'
    )
    expect(judge?.sub).toContain(
      'AI review budget: diff 305,874 chars · size limit 180,000 chars, 150 files · over by 125,874 · reviewed 3 of 4 files, 1 left out for size (99.8% of the diff)'
    )
  })

  it('budget line for a diff under the char limit (over on file count) omits "over by"', () => {
    expect(
      formatJudgeBudgetLine(
        {
          diffChars: 90_000,
          tierChars: 120_000,
          reviewedChars: 80_000,
          coveredFiles: 150,
          droppedFiles: 10,
        },
        { ...PARTIAL, reviewedFiles: 150, totalFiles: 160 }
      )
    ).toBe(
      'AI review budget: diff 90,000 chars · size limit 180,000 chars, 150 files · reviewed 150 of 160 files, 10 left out for size (11.1% of the diff)'
    )
  })

  it('the size-limit row does not depend on the truncated flag', () => {
    const fields = scanFields(
      {
        stages: { judge: 'PARTIAL' },
        partial: true,
        partialCauses: ['JUDGE_PARTIAL_OVER_CAP'],
        judgePartial: PARTIAL,
        externalFindings: 0,
        externalFailureReason: null,
      },
      { truncated: false }
    )
    expect(fields.find(f => f.label === 'AI review')?.sub).toEqual([
      'over the size limit — reviewed 3 of 4 reviewable files',
    ])
  })

  it('without a partial record the tier line is unchanged (truncation of ours still says so)', () => {
    expect(formatJudgeBudgetLine(BUDGET)).toContain('tier 60,000')
    const fields = scanFields(
      {
        stages: { judge: 'RAN' },
        partial: true,
        externalFindings: 0,
        externalFailureReason: null,
      },
      { truncated: true }
    )
    expect(JSON.stringify(fields)).toContain(
      'AI review has not covered every file yet'
    )
  })
})
