/**
 * @jest-environment node
 *
 * LUM-396 grounding gate (quote-or-discard) — batched call, per-element
 * verdict parsing, fail-open posture, and observability logging.
 */
const generateObjectMock = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: unknown[]) => generateObjectMock(...a),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

const loggerInfoMock = jest.fn()
const loggerWarnMock = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: (...a: unknown[]) => loggerInfoMock(...a),
    warn: (...a: unknown[]) => loggerWarnMock(...a),
    error: jest.fn(),
  },
}))

import {
  coerceGroundingVerdict,
  groundCandidates,
} from '@/lib/services/memory/ground-candidates'

const SOURCE = '[12:00:01] Bash "npx prisma migrate dev" ERR — stderr: P3009'
const CANDIDATES = [
  { category: 'TRAP', content: { trigger: 'migrate dev', outcome: 'P3009' } },
  { category: 'DECISION', content: { what: 'invented', why: 'invented' } },
  { category: 'CONVENTION', content: { rule: 'r', scope: 's' } },
]

beforeEach(() => {
  jest.clearAllMocks()
})

describe('groundCandidates — quote-or-discard contract', () => {
  it('makes ONE batched call carrying the source material and every candidate', async () => {
    generateObjectMock.mockResolvedValue({
      object: { verdicts: [] },
      usage: {},
    })
    await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 't',
    })
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    const arg = generateObjectMock.mock.calls[0]![0] as { prompt: string }
    expect(arg.prompt).toContain(SOURCE)
    for (let i = 0; i < CANDIDATES.length; i++) {
      expect(arg.prompt).toContain(`[${i}] ${JSON.stringify(CANDIDATES[i])}`)
    }
  })

  it('discards UNSUPPORTED candidates and keeps SUPPORTED ones verbatim (same refs, content untouched)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        verdicts: [
          { index: 0, verdict: 'SUPPORTED', quote: 'P3009' },
          { index: 1, verdict: 'UNSUPPORTED' },
          { index: 2, verdict: 'SUPPORTED', quote: 'migrate dev' },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 20 },
    })
    const out = await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 't',
    })
    expect(out.kept).toHaveLength(2)
    expect(out.kept[0]).toBe(CANDIDATES[0])
    expect(out.kept[1]).toBe(CANDIDATES[2])
    expect(out.discardedCount).toBe(1)
  })

  it('skips the LLM entirely for an empty candidate list', async () => {
    const out = await groundCandidates({
      sourceText: SOURCE,
      candidates: [],
      logTag: 't',
    })
    expect(generateObjectMock).not.toHaveBeenCalled()
    expect(out).toEqual({ kept: [], discardedCount: 0 })
  })

  it('ignores an UNSUPPORTED verdict with an out-of-range index', async () => {
    generateObjectMock.mockResolvedValue({
      object: { verdicts: [{ index: 99, verdict: 'UNSUPPORTED' }] },
      usage: {},
    })
    const out = await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 't',
    })
    expect(out.kept).toHaveLength(3)
    expect(out.discardedCount).toBe(0)
  })
})

describe('groundCandidates — loose parsing: garbage drops itself, never the batch', () => {
  it('a garbage verdict element only loses its own judgement; valid ones still apply', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        verdicts: [
          { nonsense: true },
          { index: 1, verdict: 'UNSUPPORTED' },
          { index: 2, verdict: 'MAYBE' },
        ],
      },
      usage: {},
    })
    const out = await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 't',
    })
    // index 1's valid UNSUPPORTED applies; 0 and 2 (garbage judgements) stay kept.
    expect(out.kept).toEqual([CANDIDATES[0], CANDIDATES[2]])
    expect(out.discardedCount).toBe(1)
    expect(loggerWarnMock).toHaveBeenCalled()
  })

  it('a candidate with no verdict at all stays kept (fail-open per candidate)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        verdicts: [{ index: 0, verdict: 'SUPPORTED', quote: 'P3009' }],
      },
      usage: {},
    })
    const out = await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 't',
    })
    expect(out.kept).toHaveLength(3)
  })

  it('coerces observed drift: index aliases and lowercase verdicts', () => {
    expect(coerceGroundingVerdict({ i: 1, verdict: 'unsupported' })).toEqual({
      index: 1,
      verdict: 'UNSUPPORTED',
    })
    expect(
      coerceGroundingVerdict({
        candidateIndex: '2',
        verdict: 'Supported',
        quote: 'q',
      })
    ).toEqual({
      index: 2,
      verdict: 'SUPPORTED',
      quote: 'q',
    })
    expect(coerceGroundingVerdict({ index: 0, verdict: 'PARTIAL' })).toBeNull()
    expect(coerceGroundingVerdict('garbage')).toBeNull()
    expect(coerceGroundingVerdict(null)).toBeNull()
  })

  it('fail-open: the whole grounding call failing keeps ALL candidates and never throws', async () => {
    generateObjectMock.mockRejectedValue(new Error('gateway down'))
    const out = await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 't',
    })
    expect(out.kept).toEqual(CANDIDATES)
    expect(out.discardedCount).toBe(0)
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('fail-open'),
      'gateway down'
    )
  })
})

describe('groundCandidates — observability (cost + interception logging)', () => {
  it('logs kept/discarded counts and the token usage of the extra call', async () => {
    generateObjectMock.mockResolvedValue({
      object: { verdicts: [{ index: 1, verdict: 'UNSUPPORTED' }] },
      usage: { inputTokens: 1234, outputTokens: 56 },
    })
    await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 'memory.layer1',
    })
    expect(loggerInfoMock).toHaveBeenCalledTimes(1)
    const line = loggerInfoMock.mock.calls[0]![0] as string
    expect(line).toContain('[memory.layer1]')
    expect(line).toContain('kept=2')
    expect(line).toContain('discarded=1')
    expect(line).toContain('in=1234')
    expect(line).toContain('out=56')
  })

  it('logs token usage as ? when the provider returns no usage', async () => {
    generateObjectMock.mockResolvedValue({
      object: { verdicts: [] },
      usage: undefined,
    })
    await groundCandidates({
      sourceText: SOURCE,
      candidates: CANDIDATES,
      logTag: 'memory.layer2',
    })
    const line = loggerInfoMock.mock.calls[0]![0] as string
    expect(line).toContain('kept=3')
    expect(line).toContain('discarded=0')
    expect(line).toContain('in=?')
  })
})
