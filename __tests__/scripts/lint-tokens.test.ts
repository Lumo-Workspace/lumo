import {
  countByFile,
  detectViolations,
  findRegressions,
  findZeroToleranceViolations,
  isAllowed,
  isTypeScaleScoped,
  ZERO_TOLERANCE_RULES,
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

describe('lint-tokens type-scale rule (LUM-1244)', () => {
  const typeHits = (path: string, src: string) =>
    detectViolations(path, src)
      .filter(x => x.rule === 'type-scale')
      .map(x => x.match)

  it('flags the Tailwind size scale', () => {
    expect(
      typeHits(
        'components/foo.tsx',
        `<div className="text-xs text-sm text-lg text-xl text-2xl text-3xl text-4xl text-9xl" />`
      )
    ).toEqual([
      'text-xs',
      'text-sm',
      'text-lg',
      'text-xl',
      'text-2xl',
      'text-3xl',
      'text-4xl',
      'text-9xl',
    ])
  })

  it('flags arbitrary px / rem / em sizes', () => {
    expect(
      typeHits(
        'app/foo.tsx',
        `<span className="text-[11px] text-[10.5px] text-[0.75rem] text-[1.2em]" />`
      )
    ).toEqual([
      'text-[11px]',
      'text-[10.5px]',
      'text-[0.75rem]',
      'text-[1.2em]',
    ])
  })

  it('flags font-medium / font-bold / font-extrabold / font-black', () => {
    expect(
      typeHits(
        'ee/security/foo.tsx',
        `<b className="font-medium font-bold font-extrabold font-black" />`
      )
    ).toEqual(['font-medium', 'font-bold', 'font-extrabold', 'font-black'])
  })

  it('flags classes behind variant prefixes and in .ts class-string constants', () => {
    expect(
      typeHits(
        'components/ui/menu.tsx',
        `'md:text-sm hover:font-bold data-[active=true]:font-medium sm:text-[13px]'`
      ).sort()
    ).toEqual(['font-bold', 'font-medium', 'text-[13px]', 'text-sm'])
    expect(
      typeHits('app/workspace/constants.ts', `export const C = 'text-xs'`)
    ).toEqual(['text-xs'])
  })

  it('flags bare text-base, but allows it next to an md: semantic tier', () => {
    expect(
      typeHits('app/foo.tsx', `<Button className="h-12 text-base" />`)
    ).toEqual(['text-base'])
    // iOS zoom guard on form fields: 16px on phones, body tier from md up.
    expect(
      typeHits('components/ui/input.tsx', `'px-3 text-base md:text-body'`)
    ).toEqual([])
    // An md: raw size is not a tier — both classes are flagged.
    expect(
      typeHits('components/ui/input.tsx', `'text-base md:text-sm'`)
    ).toEqual(['text-sm', 'text-base'])
  })

  it('allows the semantic tiers, font-semibold, font-normal and font-mono', () => {
    expect(
      typeHits(
        'components/foo.tsx',
        `<div className="text-caption font-semibold text-body text-body-strong text-title text-heading text-display font-normal font-mono md:text-body" />`
      )
    ).toEqual([])
  })

  it('does not flag colour / alignment utilities or look-alike names', () => {
    expect(
      typeHits(
        'components/foo.tsx',
        `<div className="text-muted-foreground text-left text-sm-foo text-[var(--chart-1)] text-balance font-medium-ish prose-sm" />`
      )
    ).toEqual([])
  })

  it('only applies to app/, components/, ee/ and skips the prose / marketing exemptions', () => {
    expect(isTypeScaleScoped('app/foo.tsx')).toBe(true)
    expect(isTypeScaleScoped('components/foo/bar.ts')).toBe(true)
    expect(isTypeScaleScoped('ee/security/x.tsx')).toBe(true)
    expect(isTypeScaleScoped('lib/editor/link-class.ts')).toBe(false)
    expect(
      isTypeScaleScoped('lib/integrations/email/templates/invite.tsx')
    ).toBe(false)
    expect(isTypeScaleScoped('app/globals.css')).toBe(false)
    expect(isTypeScaleScoped('app/page.tsx')).toBe(false)
    expect(isTypeScaleScoped('components/ui/typography.tsx')).toBe(false)
    expect(
      typeHits('components/ui/typography.tsx', `'text-4xl font-bold'`)
    ).toEqual([])
    expect(
      typeHits('components/landing/Hero.tsx', `'text-4xl font-bold'`)
    ).toEqual([])
    expect(typeHits('lib/foo.ts', `'text-sm font-medium'`)).toEqual([])
    expect(typeHits('app/foo.test.tsx', `'text-sm'`)).toEqual([])
  })

  it('a bare text-sm in a new file is a baseline regression', () => {
    const current = countByFile(
      detectViolations('app/new-page.tsx', `<p className="text-sm">x</p>`)
    )
    expect(findRegressions(current, {})).toEqual([
      { file: 'app/new-page.tsx', current: 1, baseline: 0 },
    ])
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

describe('lint-tokens css-var-syntax rule (LUM-1277)', () => {
  const cssVarHits = (path: string, src: string) =>
    detectViolations(path, src)
      .filter(x => x.rule === 'css-var-syntax')
      .map(x => x.match)

  it('flags the Tailwind v3 bracket shorthand, with or without variants', () => {
    expect(
      cssVarHits(
        'components/ui/sidebar/frame.tsx',
        `'w-[--x] !max-w-[--sidebar-width] group-data-[collapsible=icon]:w-[--sidebar-width-icon] origin-[--radix-popover-content-transform-origin]'`
      )
    ).toEqual([
      'w-[--x]',
      'max-w-[--sidebar-width]',
      'w-[--sidebar-width-icon]',
      'origin-[--radix-popover-content-transform-origin]',
    ])
  })

  it('allows the v4 parenthesis form, explicit var() and calc() values', () => {
    expect(
      cssVarHits(
        'components/ui/select.tsx',
        `'w-(--sidebar-width)! max-h-(--radix-select-content-available-height) h-[var(--radix-select-trigger-height)] w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))] data-[state=open]:animate-in'`
      )
    ).toEqual([])
  })

  it('applies to app/, components/, ee/ even in colour-allowlisted files, not to tests', () => {
    expect(cssVarHits('app/foo/page.tsx', `'w-[--x]'`)).toEqual(['w-[--x]'])
    expect(cssVarHits('ee/foo.ts', `'w-[--x]'`)).toEqual(['w-[--x]'])
    expect(isAllowed('components/ui/icons.tsx')).toBe(true)
    expect(cssVarHits('components/ui/icons.tsx', `'w-[--x]'`)).toEqual([
      'w-[--x]',
    ])
    expect(cssVarHits('lib/foo.ts', `'w-[--x]'`)).toEqual([])
    expect(cssVarHits('app/foo.test.tsx', `'w-[--x]'`)).toEqual([])
  })

  it('is zero-tolerance: a hit fails even when the file is baselined', () => {
    const violations = detectViolations(
      'components/ui/sidebar/menu.tsx',
      `'h-4 max-w-[--skeleton-width] flex-1'`
    )
    expect(findZeroToleranceViolations(violations)).toHaveLength(1)
    expect(ZERO_TOLERANCE_RULES.has('css-var-syntax')).toBe(true)
  })
})
