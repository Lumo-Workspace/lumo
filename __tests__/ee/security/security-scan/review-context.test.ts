/** @jest-environment node */
import {
  REVIEW_CONTEXT_MAX_CHARS,
  REVIEW_PROMPT_MAX_CHARS,
  reviewContextBudget,
  REVIEW_CONTEXT_MAX_FILE_CHARS,
  REVIEW_CONTEXT_MAX_READS,
  isSkippedContextPath,
  isTestPath,
  loadReviewContext,
  packReviewContext,
  packedFileBody,
} from '@/ee/security/security-scan/review-context'

const file = (path: string, chars: number, fill = 'x') => ({
  path,
  body: fill.repeat(chars),
})

describe('LUM-988 review context — packing rules', () => {
  it('skips lockfiles, binaries and generated files by path', () => {
    for (const p of [
      'package-lock.json',
      'web/yarn.lock',
      'pnpm-lock.yaml',
      'Gemfile.lock',
      'go.sum',
      'Cargo.lock',
      'dist/app.min.js',
      'dist/app.js.map',
      'logo.png',
      'fonts/a.woff2',
      '__snapshots__/x.test.ts.snap',
    ])
      expect([p, isSkippedContextPath(p)]).toEqual([p, true])
    for (const p of ['src/app.ts', 'lib/lock.ts', 'app/models/topic_embed.rb'])
      expect([p, isSkippedContextPath(p)]).toEqual([p, false])
  })

  it('recognises test files across languages', () => {
    for (const p of [
      '__tests__/a.ts',
      'src/a.test.ts',
      'spec/models/user_spec.rb',
      'pkg/a_test.go',
      'tests/test_api.py',
      'src/test/java/FooTest.java',
    ])
      expect([p, isTestPath(p)]).toEqual([p, true])
    expect(isTestPath('src/contest.ts')).toBe(false)
  })

  it('packs source before tests, then smallest first', () => {
    const packed = packReviewContext([
      file('src/big.ts', 300),
      file('src/a.test.ts', 10),
      file('src/small.ts', 100),
    ])
    expect(packed.included).toEqual([
      'src/small.ts',
      'src/big.ts',
      'src/a.test.ts',
    ])
    expect(packed.text.indexOf('=== src/small.ts ===')).toBe(0)
  })

  it('obeys the char cap with skip-and-continue', () => {
    const packed = packReviewContext(
      [file('a.ts', 400), file('b.ts', 700), file('c.test.ts', 300)],
      1_000
    )
    // a (≈410) fits, b (≈710) does not, the test file behind it still does.
    expect(packed.included).toEqual(['a.ts', 'c.test.ts'])
    expect(packed.text.length).toBeLessThanOrEqual(1_000)
  })

  it('drops skipped paths, files over the size limit, binaries and empty files', () => {
    const packed = packReviewContext([
      file('yarn.lock', 10),
      file('huge.ts', REVIEW_CONTEXT_MAX_FILE_CHARS + 1),
      { path: 'blob.dat', body: 'ab\u0000cd' },
      { path: 'empty.ts', body: '  \n' },
      file('ok.ts', 10),
    ])
    expect(packed.included).toEqual(['ok.ts'])
  })

  it('returns empty text when nothing is eligible', () => {
    expect(packReviewContext([file('yarn.lock', 10)])).toEqual({
      text: '',
      included: [],
      bodies: {},
    })
  })
})

describe('LUM-988 review context — loading', () => {
  it('reads the changed files and packs them; a missing file is skipped', async () => {
    const readFile = jest.fn(async (path: string) =>
      path === 'gone.ts' ? null : `body of ${path}`
    )
    const out = await loadReviewContext({
      paths: ['src/a.ts', 'gone.ts', 'package-lock.json', 'src/a.ts'],
      readFile,
    })
    expect(out.error).toBeNull()
    expect(out.included).toEqual(['src/a.ts'])
    expect(out.text).toContain('body of src/a.ts')
    // Lockfiles are never fetched; duplicates are read once.
    expect(readFile.mock.calls.map(c => c[0]).sort()).toEqual([
      'gone.ts',
      'src/a.ts',
    ])
  })

  it('degrades to no context when a read throws (unconfirmed repository)', async () => {
    const readFile = jest.fn(async (path: string) => {
      if (path === 'src/b.ts')
        throw Object.assign(new Error('repo_not_confirmed'), { status: 403 })
      return 'ok'
    })
    const out = await loadReviewContext({
      paths: ['src/a.ts', 'src/b.ts'],
      readFile,
    })
    expect(out).toEqual({
      text: '',
      included: [],
      error: 'repo_not_confirmed',
    })
  })

  it('degrades to no context when reads run past the timeout', async () => {
    const out = await loadReviewContext({
      paths: ['src/a.ts'],
      readFile: () => new Promise<string>(() => undefined),
      timeoutMs: 5,
    })
    expect(out.text).toBe('')
    expect(out.error).toMatch(/timed out/)
  })

  it('reads at most REVIEW_CONTEXT_MAX_READS files, source first', async () => {
    const tests = Array.from({ length: 10 }, (_, i) => `t/${i}.test.ts`)
    const src = Array.from(
      { length: REVIEW_CONTEXT_MAX_READS },
      (_, i) => `src/${i}.ts`
    )
    const readFile = jest.fn(async () => 'x')
    await loadReviewContext({ paths: [...tests, ...src], readFile })
    const read = readFile.mock.calls.map(c => (c as unknown as [string])[0])
    expect(read).toHaveLength(REVIEW_CONTEXT_MAX_READS)
    expect(read.every(p => p.startsWith('src/'))).toBe(true)
  })

  it('makes no reads when no path is eligible', async () => {
    const readFile = jest.fn(async () => 'x')
    const out = await loadReviewContext({ paths: ['yarn.lock'], readFile })
    expect(readFile).not.toHaveBeenCalled()
    expect(out).toEqual({ text: '', included: [], error: null })
  })
})

describe('LUM-988 review context — prompt budget', () => {
  it('gives context what the diff leaves of the 180k prompt, at most 100k', () => {
    expect(REVIEW_PROMPT_MAX_CHARS).toBe(180_000)
    expect(reviewContextBudget(10_000)).toBe(REVIEW_CONTEXT_MAX_CHARS)
    expect(reviewContextBudget(80_000)).toBe(100_000)
    expect(reviewContextBudget(150_000)).toBe(30_000)
    expect(reviewContextBudget(180_000)).toBe(0)
    expect(reviewContextBudget(200_000)).toBe(0)
  })
})

describe('LUM-988 review context — in-flight reads on timeout', () => {
  it('aborts the reads still running when the budget runs out', async () => {
    const signals: AbortSignal[] = []
    const out = await loadReviewContext({
      paths: ['src/a.ts', 'src/b.ts'],
      readFile: (_path, signal) => {
        signals.push(signal)
        return new Promise<string>(() => undefined)
      },
      timeoutMs: 5,
    })
    expect(out.error).toMatch(/timed out/)
    expect(signals.length).toBe(2)
    expect(signals.every(s => s.aborted)).toBe(true)
  })

  it('does not abort reads that finished in time', async () => {
    let seen: AbortSignal | null = null
    await loadReviewContext({
      paths: ['src/a.ts'],
      readFile: async (_path, signal) => {
        seen = signal
        return 'x'
      },
    })
    expect(seen!.aborted).toBe(false)
  })
})

describe('LUM-1150 packedFileBody', () => {
  it('returns each packed file exactly as read, null for one left out', () => {
    // a.ts is packed first (smaller) and carries a line shaped like b.ts's
    // block header — the text alone could not be split back reliably.
    const packed = packReviewContext([
      { path: 'a.ts', body: 'x\n=== b.ts ===\ny' },
      { path: 'b.ts', body: 'export const b = 2 // the larger file\n' },
      { path: 'yarn.lock', body: 'x' },
    ])
    expect(packed.included).toEqual(['a.ts', 'b.ts'])
    expect(packedFileBody(packed, 'a.ts')).toBe('x\n=== b.ts ===\ny')
    expect(packedFileBody(packed, 'b.ts')).toBe(
      'export const b = 2 // the larger file\n'
    )
    expect(packedFileBody(packed, 'yarn.lock')).toBeNull()
    expect(packedFileBody({ text: '', included: [] }, 'a.ts')).toBeNull()
    expect(packedFileBody(packed, 'constructor')).toBeNull()
    expect(packedFileBody(packed, '__proto__')).toBeNull()
  })
})
