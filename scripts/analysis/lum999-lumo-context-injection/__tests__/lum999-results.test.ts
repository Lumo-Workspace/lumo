/**
 * @jest-environment node
 *
 * LUM-999 — the committed results.json holds only aggregates; the episodes
 * live in episodes.jsonl.gz. Re-aggregating the episodes must give exactly
 * the committed cells, and the stream must match the recorded sha256.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  EPISODES_FILE,
  decodeEpisodes,
  encodeEpisodes,
  formatResultsJson,
  renderArmComparison,
  summarize,
  totalCost,
} from '../report'

const dir = join(__dirname, '..')
const resultsText = readFileSync(join(dir, 'results.json'), 'utf8')
const results = JSON.parse(resultsText) as {
  episodes: { file: string; count: number; sha256OfUncompressedJsonl: string }
  budget: { ledgerUsd: number }
  cells: unknown[]
}
const gz = readFileSync(join(dir, EPISODES_FILE))
const { records, sha256 } = decodeEpisodes(gz)

describe('committed results', () => {
  it('points at the episodes file with the right count and sha256', () => {
    expect(results.episodes.file).toBe(EPISODES_FILE)
    expect(records).toHaveLength(results.episodes.count)
    expect(sha256).toBe(results.episodes.sha256OfUncompressedJsonl)
  })

  it('re-aggregating the episodes gives exactly the committed cells', () => {
    expect(summarize(records)).toEqual(results.cells)
  })

  it('the ledger cost matches the budget block', () => {
    expect(totalCost(records)).toBeCloseTo(results.budget.ledgerUsd, 6)
  })

  it('the codec round-trips byte-for-byte', () => {
    expect(encodeEpisodes(records).equals(gz)).toBe(true)
  })

  it('is byte-identical to the run.ts writer (compact, prettier-ignored)', () => {
    expect(formatResultsJson(JSON.parse(resultsText) as object)).toBe(
      resultsText
    )
  })

  it('the README table puts before and after side by side', () => {
    const table = renderArmComparison(summarize(records))
    expect(table).toContain(
      '| session_summary | canary_file | flagged | claude-haiku-4-5 | 100% (8/8) | 0% (0/8) | 100% (16/16) | 8 | 0 |'
    )
    expect(table).toContain(
      '| (clean baseline) | – | – | claude-sonnet-5-5 | – | – | 100% (10/10) | 5 | 0 |'
    )
  })
})
