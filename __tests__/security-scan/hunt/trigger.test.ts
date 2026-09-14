/** @jest-environment node */
import {
  evaluateHuntTrigger,
  HUNT_SITES_MAX,
  HUNT_SITES_PER_RULE_MAX,
} from '@/lib/security-scan/hunt/trigger'

const file = (path: string, ...texts: string[]) => ({
  path,
  lines: texts.map((text, i) => ({ lineNo: i + 1, text })),
})

describe('LUM-739 hunt trigger', () => {
  it('fires on an added route handler, sink call or control call in a TS file', () => {
    expect(
      evaluateHuntTrigger({
        files: [
          file(
            'app/api/x/route.ts',
            'export async function POST(req: Request) {'
          ),
        ],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      })
    ).toEqual({
      hunt: true,
      reasons: ['diff:entry:next-route-handler'],
      // The location was always known at the moment of the match; keeping only
      // the rule id is what forced the agent to re-derive it with `rg`.
      sites: [
        {
          rule: 'entry:next-route-handler',
          path: 'app/api/x/route.ts',
          line: 1,
        },
      ],
    })
    expect(
      evaluateHuntTrigger({
        files: [file('lib/a.ts', '  await prisma.$queryRawUnsafe(q)')],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual(['diff:sink:prisma-raw'])
    expect(
      evaluateHuntTrigger({
        files: [file('lib/a.tsx', 'const body = schema.parse(json)')],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual(['diff:control:zod-parse'])
  })

  it('ignores the same text in non-TS files', () => {
    expect(
      evaluateHuntTrigger({
        files: [
          file(
            'docs/a.md',
            'export async function POST(',
            'prisma.$queryRawUnsafe(q)'
          ),
        ],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      })
    ).toEqual({ hunt: false, reasons: [], sites: [] })
  })

  it('fires on a HIGH stage-A finding or an OPEN L4 crossing', () => {
    expect(
      evaluateHuntTrigger({
        files: [],
        hasHighFinding: true,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual(['stage-a:high'])
    expect(
      evaluateHuntTrigger({
        files: [],
        hasHighFinding: false,
        hasOpenL4Crossing: true,
      }).reasons
    ).toEqual(['l4:open-crossing'])
  })
})

describe('LUM-758 follow-up — located signal sites', () => {
  it('reports the file and the added line each rule fired on', () => {
    const { sites } = evaluateHuntTrigger({
      files: [
        file(
          'lib/a.ts',
          'const x = 1',
          '  await prisma.$queryRawUnsafe(q)',
          'const y = 2',
          '  const body = schema.parse(json)'
        ),
      ],
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })
    expect(sites).toEqual([
      { rule: 'sink:prisma-raw', path: 'lib/a.ts', line: 2 },
      { rule: 'control:zod-parse', path: 'lib/a.ts', line: 4 },
    ])
  })

  it('carries a site per hit, where `reasons` collapses repeats to one id', () => {
    // Two different call sites of the same rule are one reason and two places
    // to look. The whole point of the located form is the second thing.
    const { reasons, sites } = evaluateHuntTrigger({
      files: [
        file('lib/a.ts', '  await fetch(url)'),
        file('lib/b.ts', 'const r = 0', '  await fetch(other)'),
      ],
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })
    expect(reasons).toEqual(['diff:sink:fetch'])
    expect(sites).toEqual([
      { rule: 'sink:fetch', path: 'lib/a.ts', line: 1 },
      { rule: 'sink:fetch', path: 'lib/b.ts', line: 2 },
    ])
  })

  it('caps one noisy rule so it cannot crowd out the sink that is the reason to hunt', () => {
    const noisy = file(
      'lib/a.ts',
      ...Array.from(
        { length: HUNT_SITES_PER_RULE_MAX + 5 },
        () => '  const b = schema.parse(json)'
      )
    )
    const { sites } = evaluateHuntTrigger({
      files: [noisy, file('lib/z.ts', '  await prisma.$queryRawUnsafe(q)')],
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })
    expect(sites.filter(s => s.rule === 'control:zod-parse')).toHaveLength(
      HUNT_SITES_PER_RULE_MAX
    )
    // Survived the flood — a per-rule cap is the only thing that keeps it.
    expect(sites).toContainEqual({
      rule: 'sink:prisma-raw',
      path: 'lib/z.ts',
      line: 1,
    })
  })

  it('bounds the total, because this rides in a workflow step input', () => {
    // Has to fire MANY DIFFERENT rules: with one rule the per-rule cap alone
    // holds the total down, and a test built that way passes whether or not the
    // total cap exists at all. There are 13 rules × 6 per rule = 78 possible
    // sites, comfortably over the total.
    const callers = [
      '  await fetch(url)',
      '  eval(src)',
      '  await prisma.$queryRawUnsafe(q)',
      '  const b = schema.parse(json)',
      '  redirect(next)',
      '  await generateText(opts)',
      '  await exec(cmd)',
      '  const who = await requireAuth()',
    ]
    const files = Array.from({ length: 12 }, (_, i) =>
      file(`lib/f${i}.ts`, ...callers)
    )
    const uncapped = callers.length * 12
    expect(uncapped).toBeGreaterThan(HUNT_SITES_MAX)

    const { sites } = evaluateHuntTrigger({
      files,
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })

    expect(sites.length).toBeLessThanOrEqual(HUNT_SITES_MAX)
    // …and the per-rule cap alone would not have got us there.
    const distinctRules = new Set(sites.map(x => x.rule)).size
    expect(distinctRules * HUNT_SITES_PER_RULE_MAX).toBeGreaterThan(
      HUNT_SITES_MAX
    )
  })

  it('fires on `new Function(...)`, which the trigger consulted no table for', () => {
    // NEW_EXPRESSION_SINKS has existed since LUM-739 and only the subgraph
    // builder ever read it, so a diff adding `new Function(userInput)` — code
    // injection — started no hunt at all. `planFallback`'s SINK_TO_CATEGORY
    // already maps `new-function` to `injection`: the downstream mapping was
    // written for a reason this pass never emitted.
    const { hunt, reasons, sites } = evaluateHuntTrigger({
      files: [file('lib/a.ts', 'const x = 1', '  const f = new Function(src)')],
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })
    expect(hunt).toBe(true)
    expect(reasons).toEqual(['diff:sink:new-function'])
    expect(sites).toEqual([
      { rule: 'sink:new-function', path: 'lib/a.ts', line: 2 },
    ])
  })

  it('does not fire on a plain call to something merely named Function', () => {
    // The rule is about CONSTRUCTION. Matching the callee table instead would
    // fire on `Function(src)` and on any local helper called `Function`, and a
    // trigger that fires on a name rather than a shape spends a hunt budget on
    // whatever the codebase happens to have named that way.
    expect(
      evaluateHuntTrigger({
        files: [file('lib/a.ts', '  const f = Function(src)')],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      }).reasons
    ).toEqual([])
  })

  it('has no site for a reason that has no place — stage-A and L4', () => {
    expect(
      evaluateHuntTrigger({
        files: [],
        hasHighFinding: true,
        hasOpenL4Crossing: true,
      }).sites
    ).toEqual([])
  })

  it('ignores non-source files, exactly as `reasons` does', () => {
    expect(
      evaluateHuntTrigger({
        files: [file('docs/a.md', '  await fetch(url)')],
        hasHighFinding: false,
        hasOpenL4Crossing: false,
      }).sites
    ).toEqual([])
  })
})
