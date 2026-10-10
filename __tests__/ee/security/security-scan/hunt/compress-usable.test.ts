import {
  judgeCompression,
  NO_RELEVANT_LINES,
} from '@/ee/security/security-scan/hunt/compress-usable'

describe('judgeCompression', () => {
  // The failure this module exists for: 7 calls, 38,585 chars in, 133 out —
  // exactly 7 × the sentinel. The old guard only caught a fully empty body, so
  // all seven were trusted and the agent searched a repo it could not see.
  it('rejects the sentinel the compressor is told to return when it finds nothing', () => {
    expect(judgeCompression(NO_RELEVANT_LINES)).toEqual({
      usable: false,
      reason: 'sentinel',
    })
    expect(judgeCompression('  (No Relevant Lines).  ').usable).toBe(false)
    expect(judgeCompression('no relevant lines').usable).toBe(false)
  })

  it('rejects an empty or whitespace-only body', () => {
    expect(judgeCompression('')).toEqual({ usable: false, reason: 'empty' })
    expect(judgeCompression('   \n  ').reason).toBe('empty')
  })

  it('accepts a tiny body — the best compression looks exactly like this', () => {
    // 8,000 characters of `rg` output in which exactly one line matters is the
    // outcome worth having, and it is indistinguishable BY SIZE from a refusal.
    // An earlier draft rejected anything under 1% of its input and would have
    // discarded precisely these.
    expect(judgeCompression('lib/a.ts:1: prisma.$queryRawUnsafe(id)')).toEqual({
      usable: true,
    })
  })

  it('accepts a real multi-line compression', () => {
    const body = Array.from(
      { length: 40 },
      (_, i) => `lib/services/a.ts:${i + 1}: prisma.$queryRawUnsafe(id)`
    ).join('\n')
    expect(judgeCompression(body)).toEqual({ usable: true })
  })

  // No drift test is needed: `security-hunt-compress-client.ts` interpolates
  // NO_RELEVANT_LINES into its own prompt, so the sentence the compressor is
  // asked for and the sentence this guard matches are the same string by
  // construction. (A test could not import that module anyway — it statically
  // imports `ai`, which breaks jest.)
})
