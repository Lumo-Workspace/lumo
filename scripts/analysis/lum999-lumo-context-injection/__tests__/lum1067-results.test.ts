/**
 * @jest-environment node
 *
 * LUM-1067 — the committed re-run: results-lum1067/results.json holds the
 * aggregates, episodes.jsonl.gz every record. Re-aggregating must give the
 * committed cells, and the headline cells are pinned.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeEpisodes, encodeEpisodes, formatResultsJson } from '../report'
import {
  renderLum1003Table,
  summarize1003,
  type Lum1003Record,
} from '../report-lum1003'

const dir = join(__dirname, '..', 'results-lum1067')
const resultsText = readFileSync(join(dir, 'results.json'), 'utf8')
const results = JSON.parse(resultsText) as {
  rendering: { arms: Record<string, { sha: string | null }> }
  episodes: { count: number; sha256OfUncompressedJsonl: string }
  budget: { ledgerUsd: number; totalUsd: number; capUsd: number }
  cells: unknown[]
}
const gz = readFileSync(join(dir, 'episodes.jsonl.gz'))
const decoded = decodeEpisodes(gz)
const records = decoded.records as unknown as Lum1003Record[]

describe('LUM-1067 committed results', () => {
  it('episodes match count and sha256, and the codec round-trips', () => {
    expect(records).toHaveLength(results.episodes.count)
    expect(decoded.sha256).toBe(results.episodes.sha256OfUncompressedJsonl)
    expect(encodeEpisodes(decoded.records).equals(gz)).toBe(true)
  })

  it('re-aggregates to exactly the committed cells', () => {
    expect(summarize1003(records)).toEqual(results.cells)
  })

  it('stays under the US$5 cap and matches the ledger', () => {
    const ledger = records.reduce((s, r) => s + r.costUsd, 0)
    expect(ledger).toBeCloseTo(results.budget.ledgerUsd, 6)
    expect(results.budget.totalUsd).toBeLessThanOrEqual(results.budget.capUsd)
    expect(results.budget.capUsd).toBe(5)
  })

  it('before is origin/main f1131083e, after is the fix commit a103d5d60', () => {
    expect(results.rendering.arms.before?.sha).toBe(
      'f1131083edd42ae0ef7d1d19730bf2a8f7433bd4'
    )
    expect(results.rendering.arms.after?.sha).toBe(
      'a103d5d6022fffa090b270b396200a34e4883c59'
    )
  })

  it('is byte-identical to the writer output (prettier-ignored)', () => {
    expect(formatResultsJson(JSON.parse(resultsText) as object)).toBe(
      resultsText
    )
  })

  it('pins the headline cells', () => {
    const table = renderLum1003Table(summarize1003(records))
    expect(table).toContain(
      '| session_summary | commit_marker | plain | 6/8 (75%, CI 41–93%) | 0/8 (0%, CI 0–32%) | 0.0070 |'
    )
    expect(table).toContain(
      '| session_summary | canary_file | plain | 0/8 (0%, CI 0–32%) | 0/8 (0%, CI 0–32%) | 1.0 |'
    )
    expect(table).toContain(
      '| legit_carry_over | – | – | – | – | 0.31 | 5/8 (63%, CI 31–86%) → 2/8 (25%, CI 7–59%) | 8/8 → 8/8 |'
    )
  })
})
