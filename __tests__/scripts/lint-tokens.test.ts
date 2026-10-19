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

  it('flags brand-palette colors (red/blue/violet/...) as brand (LUM-290)', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="text-blue-500 bg-emerald-100 ring-violet-400" />`
    )
    expect(v.map(x => x.match).sort()).toEqual([
      'bg-emerald-100',
      'ring-violet-400',
      'text-blue-500',
    ])
    expect(v.every(x => x.rule === 'brand')).toBe(true)
  })

  it('does NOT flag the --chart-* token utilities (bg-chart-1, text-chart-5)', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="bg-chart-1 text-chart-5 fill-chart-3" />`
    )
    expect(v).toEqual([])
  })

  it('keeps neutral palettes on the `palette` rule, brand on `brand`', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="bg-zinc-500 bg-blue-500" />`
    )
    const byMatch = Object.fromEntries(v.map(x => [x.match, x.rule]))
    expect(byMatch).toEqual({
      'bg-zinc-500': 'palette',
      'bg-blue-500': 'brand',
    })
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
  it('flags bare `rounded` (no tier suffix)', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `<div className="rounded border p-2" />`
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ match: 'rounded', rule: 'radius' })
  })

  it('does NOT flag tiered/directional/arbitrary rounded', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="rounded-md rounded-full rounded-l-lg rounded-[2px]" />`
    )
    expect(v).toEqual([])
  })

  it('does NOT flag `rounded` inside another word (surrounded)', () => {
    const v = detectViolations('lib/foo.ts', `const s = 'surrounded'`)
    expect(v).toEqual([])
  })

  it('flags Tailwind built-in shadow scale and arbitrary shadow', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `<div className="shadow shadow-md hover:shadow-lg shadow-[0_0_0_1px_red]" />`
    )
    expect(v.map(x => x.match).sort()).toEqual([
      'shadow',
      'shadow-[0_0_0_1px_red]',
      'shadow-lg',
      'shadow-md',
    ])
    expect(v.every(x => x.rule === 'shadow')).toBe(true)
  })

  it('does NOT flag shadow-elevation-*, shadow-none, shadow-mockup, drop-shadow', () => {
    const v = detectViolations(
      'app/foo.tsx',
      `<div className="shadow-elevation-1 shadow-none shadow-mockup drop-shadow-[2px_1px_24px_var(--x)]" />`
    )
    expect(v).toEqual([])
  })

  it('does NOT flag the `shadow` inside box-shadow CSS property', () => {
    const v = detectViolations(
      'components/foo.css',
      `.x { box-shadow: 0 0 0; }`
    )
    expect(v).toEqual([])
  })
})

describe('lint-tokens / isAllowed', () => {
  it('matches the listed token-definition files', () => {
    expect(isAllowed('app/globals.css')).toBe(true)
    expect(isAllowed('components/landing/landing.css')).toBe(true)
    expect(isAllowed('components/ui/icons.tsx')).toBe(true)
    // LUM-1245: signup is tokenized under a `.dark` scope, so it is linted.
    expect(isAllowed('app/signup/[[...signup]]/page.tsx')).toBe(false)
    // Vendored shadcn-io decorative block (gradient hex stops are payload).
    expect(
      isAllowed('components/ui/shadcn-io/aurora-background/index.tsx')
    ).toBe(true)
    // Categorical tag palette module (decorative hex stops are payload).
    expect(
      isAllowed(
        'app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/tag-colors.ts'
      )
    ).toBe(true)
    // Tag color presets module (payload hex the user picks from).
    expect(
      isAllowed(
        'app/workspace/[workspaceUrl]/components/pages/tag-color-presets.ts'
      )
    ).toBe(true)
    // Default agent avatar color (payload hex, not a token).
    expect(isAllowed('lib/constants/avatar.ts')).toBe(true)
    // Editor font/highlight palettes (payload hex written into the document).
    expect(
      isAllowed(
        'app/workspace/[workspaceUrl]/components/bubble-menu/editor-colors.ts'
      )
    ).toBe(true)
    // Document tag color palettes (payload hex hashed onto tags).
    expect(
      isAllowed(
        'app/workspace/[workspaceUrl]/components/document/tag-colors.ts'
      )
    ).toBe(true)
    // Payload color constants (DB-stored data hex, not tokens).
    expect(isAllowed('lib/constants/colors.ts')).toBe(true)
    // Agent brand colors (per-agent badge accent).
    expect(
      isAllowed('app/workspace/[workspaceUrl]/components/AgentBadge.tsx')
    ).toBe(true)
    // Vendor brand logo SVGs (brand hex is the icon payload).
    expect(
      isAllowed('app/workspace/[workspaceUrl]/components/SlackIcon.tsx')
    ).toBe(true)
    expect(isAllowed('components/icons/SlackIcon.tsx')).toBe(true)
    // Email templates (inline hex required — no CSS vars in email).
    expect(isAllowed('lib/integrations/email/templates/invite.ts')).toBe(true)
    // Landing marketing surface (intentional brand fork).
    expect(isAllowed('components/landing/ui/button.tsx')).toBe(true)
    // Vendored shadcn NavigationMenu (local z-[1] stacking carve-out).
    expect(isAllowed('components/ui/navigation-menu.tsx')).toBe(true)
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

describe('lint-tokens zindex rule', () => {
  it('flags arbitrary z-[..] utilities in business code', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `const a = <div className="z-[100] flex" />\nconst b = <div className="z-[1]" />`
    )
    const zindex = v.filter(x => x.rule === 'zindex')
    expect(zindex.map(x => x.match)).toEqual(['z-[100]', 'z-[1]'])
  })

  it('does NOT flag named z utilities', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `<div className="z-50 z-dropdown z-modal z-10" />`
    )
    expect(v.filter(x => x.rule === 'zindex')).toHaveLength(0)
  })

  it('respects the allowlist and skips test files', () => {
    expect(
      detectViolations('app/globals.css', 'z-[100]').filter(
        x => x.rule === 'zindex'
      )
    ).toHaveLength(0)
    expect(
      detectViolations('components/foo.test.tsx', 'z-[100]').filter(
        x => x.rule === 'zindex'
      )
    ).toHaveLength(0)
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
