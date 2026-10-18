/**
 * @jest-environment node
 *
 * LUM-1144 — a partial AI review over the size cap, as every surface tells
 * it: the PR summary and `lumo pr scan` / `lumo task status` name the skipped
 * files and how to get them reviewed; it is a limit on the change, never our
 * "didn't finish", and never "checked".
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import { buildSummary } from '@/ee/security/services/security-pr-review.service'
import {
  hasSizeNotice,
  judgeOverCapOf,
  judgePartialOf,
  scanSizeCaps,
} from '@/ee/security/security-scan/size-caps'
import { parseJudgeBudget } from '@/ee/security/security-scan/judge-budget'
import {
  formatJudgeOverCap,
  formatJudgePartial,
  isOwnedUnfinished,
  isUnfinishedOnlyBySize,
  partialCauseClass,
  scanCoverageState,
} from '@/shared/src/security-scan'
import { formatSizeCapLines, scanLayerNotes } from '@/cli/src/lib/scan-format'

const SKIPPED = ['lib/a`b.ts', 'lib/two.ts']
const BUDGET = {
  diffChars: 186_000,
  tierChars: 180_000,
  reviewedChars: 170_000,
  coveredFiles: 8,
  droppedFiles: 2,
  overCap: {
    files: 10,
    capFiles: 150,
    capChars: 180_000,
    skippedPaths: SKIPPED,
  },
}
const STAGES = { secrets: 'RAN', judge: 'PARTIAL' } as const
const CAUSES = ['JUDGE_PARTIAL_OVER_CAP']

describe('size-caps: judgePartialOf', () => {
  it('reads the partial-review facts off the row', () => {
    expect(
      judgePartialOf({
        stages: STAGES,
        partialCauses: CAUSES,
        judgeBudget: BUDGET,
      })
    ).toEqual({
      reviewedFiles: 8,
      totalFiles: 10,
      capFiles: 150,
      capChars: 180_000,
      skippedPaths: SKIPPED,
    })
  })

  it('null without the cause, on a non-PARTIAL judge, or a half-written record', () => {
    expect(
      judgePartialOf({ stages: STAGES, partialCauses: [], judgeBudget: BUDGET })
    ).toBeNull()
    expect(
      judgePartialOf({
        stages: { judge: 'FAILED' },
        partialCauses: CAUSES,
        judgeBudget: BUDGET,
      })
    ).toBeNull()
    expect(
      judgePartialOf({
        stages: STAGES,
        partialCauses: CAUSES,
        judgeBudget: { ...BUDGET, overCap: { files: 10 } },
      })
    ).toBeNull()
  })

  it('hasSizeNotice counts a partial review; the budget line still parses', () => {
    const caps = scanSizeCaps({
      stages: STAGES,
      partialCauses: CAUSES,
      judgeBudget: BUDGET,
    })
    expect(hasSizeNotice(caps)).toBe(true)
    expect(parseJudgeBudget(BUDGET)).toEqual({
      diffChars: 186_000,
      tierChars: 180_000,
      reviewedChars: 170_000,
      coveredFiles: 8,
      droppedFiles: 2,
    })
  })

  it('an over-cap row carries its file numbers', () => {
    expect(
      judgeOverCapOf({
        stages: { judge: 'SKIPPED' },
        partialCauses: ['JUDGE_OVER_CAP'],
        judgeBudget: {
          ...BUDGET,
          diffChars: 90_000,
          overCap: { ...BUDGET.overCap, files: 240 },
        },
      })
    ).toEqual({
      diffChars: 90_000,
      capChars: 180_000,
      files: 240,
      capFiles: 150,
    })
  })
})

describe('shared wording', () => {
  it('names the skipped files, counts the rest, says how to get them', () => {
    const many = Array.from({ length: 13 }, (_, i) => `f${i}.ts`)
    const text = formatJudgePartial({
      reviewedFiles: 40,
      totalFiles: 53,
      capFiles: 150,
      capChars: 180_000,
      skippedPaths: many,
    })
    expect(text).toContain('covered 40 of 53 reviewable files')
    expect(text).toContain('f9.ts and 3 more')
    expect(text).not.toContain('f10.ts')
    expect(text).toContain('split the PR')
  })

  it('over by file count alone says files; by characters keeps the old line', () => {
    expect(
      formatJudgeOverCap({
        diffChars: 90_000,
        capChars: 180_000,
        files: 240,
        capFiles: 150,
      })
    ).toContain('changes 240 reviewable files')
    expect(formatJudgeOverCap({ diffChars: 200_000, capChars: 180_000 })).toBe(
      "This PR's diff is 200,000 characters; AI review runs on up to 180,000, so it did not run. To get it, narrow the review scope or split the PR."
    )
  })

  it('a partial review is a size limit: not checked, not owned', () => {
    expect(partialCauseClass('JUDGE_PARTIAL_OVER_CAP')).toBe('COVERAGE_OWED')
    expect(
      scanCoverageState({ status: 'CLEAN', stages: STAGES, partial: true })
    ).toBe('UNFINISHED')
    expect(
      isUnfinishedOnlyBySize({
        status: 'CLEAN',
        stages: STAGES,
        partialCauses: CAUSES,
      })
    ).toBe(true)
    expect(
      isOwnedUnfinished({
        status: 'CLEAN',
        stages: STAGES,
        partial: true,
        partialCauses: CAUSES,
        hasSizeNotice: true,
      })
    ).toBe(false)
    // A budget cut of ours on top keeps the owned line.
    expect(
      isUnfinishedOnlyBySize({
        status: 'CLEAN',
        stages: STAGES,
        partialCauses: [...CAUSES, 'JUDGE_TRUNCATED'],
      })
    ).toBe(false)
    // Another layer's PARTIAL is not excused by the judge's cause.
    expect(
      isUnfinishedOnlyBySize({
        status: 'CLEAN',
        stages: { ...STAGES, hunt: 'PARTIAL' },
        partialCauses: CAUSES,
      })
    ).toBe(false)
  })
})

describe('PR summary', () => {
  const input = {
    headSha: 'abcdef1234567890',
    stages: STAGES as never,
    status: 'CLEAN' as const,
    partial: true,
    partialCauses: CAUSES,
    externalCounts: {},
    open: 0,
    blocking: 0,
    error: null,
    taskUrl: null,
    repo: 'acme/app',
    prNumber: 9,
    commandHandle: '@uselumo',
    ...scanSizeCaps({
      stages: STAGES,
      partialCauses: CAUSES,
      judgeBudget: BUDGET,
    }),
  }

  it('lists the skipped files as code spans and the full-review command', () => {
    const body = buildSummary(input)
    expect(body).toContain('covered 8 of 10 reviewable files')
    expect(body).toContain('`lib/ab.ts`')
    expect(body).toContain('`lib/two.ts`')
    expect(body).toContain('comment `@uselumo full review`')
    expect(body).toContain('No open findings in the checks that ran.')
    expect(body).not.toMatch(/hasn't finished on our side/i)
  })
})

describe('CLI', () => {
  it('prints the partial-review line, terminal-safe, and no owned note', () => {
    const caps = scanSizeCaps({
      stages: STAGES,
      partialCauses: CAUSES,
      judgeBudget: {
        ...BUDGET,
        overCap: { ...BUDGET.overCap, skippedPaths: ['lib/\u001b[31mred.ts'] },
      },
    })
    const lines = formatSizeCapLines(caps)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('covered 8 of 10 reviewable files')
    expect(lines[0]).toContain('lumo pr review <number> --full')
    expect(lines[0]).not.toContain('\u001b')
    expect(
      scanLayerNotes({
        status: 'CLEAN',
        stages: STAGES,
        partial: true,
        partialCauses: CAUSES,
        externalFindings: 0,
        externalFailureReason: null,
        ...caps,
      })
    ).toEqual([])
  })
})
