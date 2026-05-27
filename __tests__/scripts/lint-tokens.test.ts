import {
  countByFile,
  detectViolations,
  findRegressions,
  isAllowed,
} from '@/scripts/lint-tokens'

describe('lint-tokens / detectViolations', () => {
  it('flags raw hex literals in business code', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `const c = '#1a1a1a';\nconst d = "#fff"\n`
    )
    expect(v).toHaveLength(2)
    expect(v[0]).toMatchObject({
      file: 'components/foo.tsx',
      line: 1,
      rule: 'hex',
      match: '#1a1a1a',
    })
    expect(v[1]).toMatchObject({ line: 2, match: '#fff', rule: 'hex' })
  })

  it('flags neutral palette classes (zinc/slate/gray/neutral/stone)', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="text-zinc-500 bg-slate-100 border-gray-200" />`
    )
    expect(v.map(x => x.match).sort()).toEqual([
      'bg-slate-100',
      'border-gray-200',
      'text-zinc-500',
    ])
    expect(v.every(x => x.rule === 'palette')).toBe(true)
  })

  it('does NOT flag brand-palette colors (red/blue/violet/...)', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="text-blue-500 bg-emerald-100 ring-violet-400" />`
    )
    expect(v).toEqual([])
  })

  it('does NOT match hex inside identifiers (cmt#abc123, foo#bar)', () => {
    // The leading `(?<!\w)` should prevent matches glued to a word char.
    const v = detectViolations(
      'lib/foo.ts',
      `const id = 'cmt#abc123';\nconst tag = 'foo#bar456';\n`
    )
    expect(v).toEqual([])
  })

  it('matches hex in CSS values', () => {
    const v = detectViolations(
      'components/foo.css',
      `.x { color: #ff0000; background: #ABC; }`
    )
    expect(v.map(x => x.match)).toEqual(['#ff0000', '#ABC'])
  })

  it('handles palette classes with opacity suffix (bg-zinc-800/50)', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="bg-zinc-800/50" />`
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ match: 'bg-zinc-800/50', rule: 'palette' })
  })

  it('skips co-located .test.tsx files', () => {
    const v = detectViolations(
      'app/foo.test.tsx',
      `const c = '#1a1a1a'; <div className="text-zinc-500" />`
    )
    expect(v).toEqual([])
  })

  it('skips files in the ALLOWLIST', () => {
    const v = detectViolations(
      'app/globals.css',
      `:root { --background: #ffffff; }`
    )
    expect(v).toEqual([])
  })

  it('reports accurate line/col positions for multi-line content', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `line one\n  ${' '.repeat(0)}#deadbe\n`
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ line: 2, col: 3, match: '#deadbe' })
  })
})

describe('lint-tokens / isAllowed', () => {
  it('matches the listed token-definition files', () => {
    expect(isAllowed('app/globals.css')).toBe(true)
    expect(isAllowed('components/landing/landing.css')).toBe(true)
    expect(isAllowed('components/ui/icons.tsx')).toBe(true)
  })

  it('rejects business code paths', () => {
    expect(isAllowed('app/foo.tsx')).toBe(false)
    expect(isAllowed('components/ui/button.tsx')).toBe(false)
    expect(isAllowed('lib/services/task.service.ts')).toBe(false)
  })

  it('does not partial-match similar names', () => {
    expect(isAllowed('app/globals.css.backup')).toBe(false)
    expect(isAllowed('app/my-globals.css')).toBe(false)
  })
})

describe('lint-tokens / countByFile', () => {
  it('counts violations per file', () => {
    const counts = countByFile([
      { file: 'a.tsx', line: 1, col: 1, match: '#fff', rule: 'hex' },
      { file: 'a.tsx', line: 2, col: 1, match: '#000', rule: 'hex' },
      { file: 'b.tsx', line: 1, col: 1, match: 'bg-zinc-500', rule: 'palette' },
    ])
    expect(counts).toEqual({ 'a.tsx': 2, 'b.tsx': 1 })
  })

  it('returns empty object for no violations', () => {
    expect(countByFile([])).toEqual({})
  })
})

describe('lint-tokens / findRegressions', () => {
  it('flags files whose violation count grew', () => {
    const r = findRegressions(
      { 'a.tsx': 3, 'b.tsx': 5 },
      { 'a.tsx': 2, 'b.tsx': 5 }
    )
    expect(r).toEqual([{ file: 'a.tsx', current: 3, baseline: 2 }])
  })

  it('flags brand-new files with any violations as regressions', () => {
    const r = findRegressions({ 'new.tsx': 1 }, {})
    expect(r).toEqual([{ file: 'new.tsx', current: 1, baseline: 0 }])
  })

  it('does NOT flag files whose count shrank (allows cleanup)', () => {
    const r = findRegressions({ 'a.tsx': 1 }, { 'a.tsx': 5 })
    expect(r).toEqual([])
  })

  it('does NOT flag a file with count equal to baseline', () => {
    const r = findRegressions({ 'a.tsx': 5 }, { 'a.tsx': 5 })
    expect(r).toEqual([])
  })

  it('returns regressions sorted by file path', () => {
    const r = findRegressions({ 'z.tsx': 2, 'a.tsx': 1, 'm.tsx': 3 }, {})
    expect(r.map(x => x.file)).toEqual(['a.tsx', 'm.tsx', 'z.tsx'])
  })
})
