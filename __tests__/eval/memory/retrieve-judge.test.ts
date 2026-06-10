/**
 * LUM-414 judge gating — KEYLESS, deterministic. Loading the module in jest is
 * itself part of the contract: a static @ai-sdk/gateway import would crash the
 * suite (TransformStream trap), so these tests pin the dynamic-import +
 * key-check-first discipline.
 */
import {
  fragmentText,
  judgedPairs,
  runJudgeOnce,
  RETRIEVE_JUDGE_RUNS,
} from '@/scripts/eval/memory/retrieve-judge'
import { retrieveQuerySet } from '@/scripts/eval/memory/retrieve-set'

describe('retrieve judge gating (LUM-414)', () => {
  const savedKey = process.env.AI_GATEWAY_API_KEY

  afterEach(() => {
    if (savedKey === undefined) delete process.env.AI_GATEWAY_API_KEY
    else process.env.AI_GATEWAY_API_KEY = savedKey
  })

  it('skips cleanly without AI_GATEWAY_API_KEY (key check before any gateway import)', async () => {
    delete process.env.AI_GATEWAY_API_KEY
    await expect(runJudgeOnce([], 0)).rejects.toThrow(/AI_GATEWAY_API_KEY/)
  })

  it('reports k-run consistency, not a single pass', () => {
    expect(RETRIEVE_JUDGE_RUNS).toBeGreaterThanOrEqual(2)
  })

  it('builds one judged pair per gold query from the ceiling injection', async () => {
    const pairs = await judgedPairs(5)
    expect(pairs).toHaveLength(retrieveQuerySet.length)
    for (const p of pairs) {
      expect(p.fragmentIds.length).toBeGreaterThan(0)
      expect(p.fragmentIds.length).toBeLessThanOrEqual(5)
      // Every judged fragment must render to non-empty judge-readable text.
      for (const id of p.fragmentIds) {
        expect(fragmentText(id).trim().length).toBeGreaterThan(0)
      }
    }
  })
})
