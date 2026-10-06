/** @jest-environment node */
import {
  extractDiffSymbols,
  loadRelatedContext,
  packRelatedSnippets,
  pathProximity,
  type RelatedSearch,
} from '@/lib/security-scan/related-context'

const DIFF = [
  'diff --git a/src/billing/charge.py b/src/billing/charge.py',
  '--- a/src/billing/charge.py',
  '+++ b/src/billing/charge.py',
  '@@ -10,6 +10,8 @@ def compute_total(order):',
  '-def apply_discount(order, rate):',
  '+def apply_discount(order, rate, cap):',
  '+    total = lookup_tax_rate(order.region) * rate',
  '+    if total > cap: return cap',
  '+    print(total)',
  ' unchanged_call(x)',
].join('\n')

describe('LUM-988 related context: symbols', () => {
  it('collects defined names from changed lines and hunk headers, called names from added lines', () => {
    const s = extractDiffSymbols(DIFF)
    expect(s.defined).toEqual(['compute_total', 'apply_discount'])
    expect(s.called).toEqual(['lookup_tax_rate'])
  })

  it('drops common and short names, and names the diff itself defines', () => {
    const s = extractDiffSymbols(
      '+++ b/a.ts\n+function renderRow(x) { return map(x) }\n+renderRow(fetch(y))'
    )
    expect(s.defined).toEqual(['renderRow'])
    expect(s.called).toEqual([])
  })
})

describe('LUM-988 related context: proximity and packing', () => {
  it('pathProximity counts shared leading directories with the nearest path', () => {
    expect(pathProximity('a/b/c.ts', ['a/b/d.ts'])).toBe(2)
    expect(pathProximity('a/x/y.ts', ['z.ts', 'a/b/d.ts'])).toBe(1)
    expect(pathProximity('q/r.ts', ['a/b/d.ts'])).toBe(0)
  })

  it('merges overlapping windows per file and skips what does not fit', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    const files = new Map([['f.py', lines]])
    const out = packRelatedSnippets(
      [
        { path: 'f.py', start: 2, end: 6, why: 'uses a' },
        { path: 'f.py', start: 5, end: 9, why: 'uses b' },
        { path: 'f.py', start: 20, end: 40, why: 'defines c' },
        { path: 'missing.py', start: 1, end: 3, why: 'x' },
      ],
      files,
      10_000
    )
    expect(out.included).toBe(2)
    expect(out.text).toContain('=== f.py:2-9 (uses a) ===\nline 2')
    expect(out.text).toContain('=== f.py:20-30 (defines c) ===')
    expect(
      packRelatedSnippets(
        [{ path: 'f.py', start: 1, end: 30, why: 'w' }],
        files,
        20
      ).text
    ).toBe('')
  })
})

describe('LUM-988 related context: loading', () => {
  const body = Array.from({ length: 40 }, (_, i) => `l${i + 1}`).join('\n')
  const search = (over: Partial<RelatedSearch> = {}): RelatedSearch => ({
    usages: async name =>
      name === 'apply_discount'
        ? [
            { path: 'src/billing/charge.py', line: 3 },
            { path: 'tests/test_charge.py', line: 5 },
            { path: 'src/billing/invoice.py', line: 12 },
          ]
        : [],
    definitions: async name =>
      name === 'lookup_tax_rate'
        ? [
            { path: 'lib/vendor_x/tax.py', line: 4 },
            { path: 'src/billing/tax.py', line: 8 },
          ]
        : [],
    read: async () => body,
    ...over,
  })

  it('finds callers outside the changed files (non-test first) and nearby definitions only', async () => {
    const out = await loadRelatedContext({
      diff: DIFF,
      changedPaths: ['src/billing/charge.py'],
      search: search(),
    })
    expect(out.error).toBeNull()
    const headers = out.text.split('\n').filter(l => l.startsWith('==='))
    expect(headers).toEqual([
      '=== src/billing/invoice.py:8-16 (uses apply_discount) ===',
      '=== tests/test_charge.py:1-9 (uses apply_discount) ===',
      '=== src/billing/tax.py:6-22 (defines lookup_tax_rate) ===',
    ])
  })

  it('skips a name with too many usages, and never throws on a failed search', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      path: `p${i}.py`,
      line: 1,
    }))
    const noisy = await loadRelatedContext({
      diff: DIFF,
      changedPaths: ['src/billing/charge.py'],
      search: search({ usages: async () => many, definitions: async () => [] }),
    })
    expect(noisy.text).toBe('')
    const failed = await loadRelatedContext({
      diff: DIFF,
      changedPaths: [],
      search: search({
        usages: async () => {
          throw new Error('rg died')
        },
      }),
    })
    expect(failed).toMatchObject({ text: '', error: 'rg died' })
  })

  it('returns nothing without searching when there is no budget', async () => {
    const usages = jest.fn()
    const out = await loadRelatedContext({
      diff: DIFF,
      changedPaths: [],
      maxChars: 0,
      search: search({ usages }),
    })
    expect(out.text).toBe('')
    expect(usages).not.toHaveBeenCalled()
  })
})
