import { getEdgeCost } from '@/lib/repositories/lineage-cost'

const cost = {
  inputTokens: 10,
  outputTokens: 2,
  cacheReadTokens: 1,
  cacheCreationTokens: 0,
  loopCount: 3,
}

describe('getEdgeCost', () => {
  it('returns the run cost when runId/run is present (run-first)', () => {
    const edge = {
      runId: 'run_1',
      run: { ...cost },
      sessionId: 'sess_1',
      session: { ...cost, inputTokens: 999 },
    }
    expect(getEdgeCost(edge)).toEqual(cost)
  })

  it('falls back to session cost when there is no run', () => {
    const edge = {
      runId: null,
      run: null,
      sessionId: 'sess_1',
      session: { ...cost },
    }
    expect(getEdgeCost(edge)).toEqual(cost)
  })

  it('returns null when neither side carries cost', () => {
    expect(
      getEdgeCost({ runId: null, run: null, sessionId: null, session: null })
    ).toBeNull()
  })

  it('treats an all-null run as no cost and falls back to session', () => {
    const edge = {
      runId: 'run_1',
      run: {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        loopCount: null,
      },
      sessionId: 'sess_1',
      session: { ...cost },
    }
    expect(getEdgeCost(edge)).toEqual(cost)
  })
})
