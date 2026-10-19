/**
 * @jest-environment node
 *
 * LUM-1208 — the server config context is paid for out of the review's
 * context budget and recorded on the budget line.
 */
import { parseJudgeBudget } from '@/ee/security/security-scan/judge-budget'
import { formatJudgeBudgetLine } from '@/cli/src/lib/scan-format'

const BUDGET = {
  diffChars: 1_000,
  tierChars: 60_000,
  reviewedChars: 1_000,
  coveredFiles: 2,
  droppedFiles: 0,
}

describe('LUM-1208 server config on the judge budget', () => {
  it('parses a recorded server config, and ignores a malformed one', () => {
    expect(
      parseJudgeBudget({
        ...BUDGET,
        serverConfig: { paths: ['frontend/Trunk.toml'], chars: 255 },
      })
    ).toEqual({
      ...BUDGET,
      serverConfig: { paths: ['frontend/Trunk.toml'], chars: 255 },
    })
    expect(
      parseJudgeBudget({ ...BUDGET, serverConfig: { paths: 'x', chars: -1 } })
    ).toEqual(BUDGET)
    // No record: the five numbers, unchanged (pre-LUM-1208 rows).
    expect(parseJudgeBudget(BUDGET)).toEqual(BUDGET)
  })

  it('the CLI budget line names the read-only config files and their size', () => {
    expect(
      formatJudgeBudgetLine({
        ...BUDGET,
        serverConfig: { paths: ['frontend/Trunk.toml'], chars: 255 },
      })
    ).toBe(
      'AI review budget: diff 1,000 chars · tier 60,000 · 59,000 left (98%) · server config 1 file (255 chars, read-only): frontend/Trunk.toml'
    )
    expect(formatJudgeBudgetLine(BUDGET)).not.toContain('server config')
  })
})
