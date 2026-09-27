import { generateObject } from 'ai'

jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  buildUsageJudgePrompt,
  judgeFragmentUsage,
  applyMarginalValueGate,
  usageJudgeSchema,
  type JudgeFragment,
} from '@/lib/services/lineage/usage-judge'

const fragments: JudgeFragment[] = [
  {
    fragmentType: 'MEMORY',
    fragmentId: 'm1',
    content: 'Prisma drift workaround: run db execute + migrate resolve',
  },
  { fragmentType: 'WEB_LINK', fragmentId: 'w1', content: 'Neon pooling docs' },
]

describe('buildUsageJudgePrompt', () => {
  it('includes every fragment with a stable handle and its content', () => {
    const { system, user } = buildUsageJudgePrompt({
      taskTitle: 'Fix drift',
      fragments,
      eventLog: 'Bash "npx prisma db execute" OK',
    })
    expect(system).toMatch(/evidence/i)
    // Pin the core safety property: abstain-by-default; absence of mention is not evidence.
    expect(system).toMatch(/OMIT|abstain/i)
    expect(system).toMatch(/leave a fragment out of BOTH lists/i)
    expect(user).toContain('MEMORY::m1')
    expect(user).toContain('Prisma drift workaround')
    expect(user).toContain('WEB_LINK::w1')
    expect(user).toContain('npx prisma db execute')
  })

  it('asks for marginal value beyond CLAUDE.md / common sense, graded HIGH/LOW', () => {
    const { system } = buildUsageJudgePrompt({
      taskTitle: 't',
      fragments,
      eventLog: 'x',
    })
    expect(system).toMatch(/marginal value/i)
    expect(system).toMatch(/CLAUDE\.md/)
    expect(system).toMatch(/HIGH/)
    expect(system).toMatch(/LOW/)
  })

  it('schema grades a used ref (defaulting to LOW) and rejects unknown fragmentType', () => {
    const ok = usageJudgeSchema.safeParse({
      used: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'm1',
          evidence: 'ran db execute',
        },
      ],
    })
    expect(ok.success).toBe(true)
    // LUM-589: value defaults to LOW when the (weak-schema) model omits the
    // grade — a missing grade must not silently earn HIGH marginal-value credit.
    expect(ok.success && ok.data.used[0]?.value).toBe('LOW')
    const graded = usageJudgeSchema.safeParse({
      used: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'm1',
          evidence: 'e',
          value: 'LOW',
        },
      ],
    })
    expect(graded.success && graded.data.used[0]?.value).toBe('LOW')
    const bad = usageJudgeSchema.safeParse({
      used: [{ fragmentType: 'NOPE', fragmentId: 'x', evidence: 'e' }],
    })
    expect(bad.success).toBe(false)
  })
})

describe('applyMarginalValueGate (marginal-value credit)', () => {
  const CLAUDE_MD = 'Prefer named exports over default exports'

  it('withholds credit for constitution-redundant fragment', () => {
    const frags: JudgeFragment[] = [
      // restates a CLAUDE.md rule almost verbatim → no marginal value
      {
        fragmentType: 'MEMORY',
        fragmentId: 'dup',
        content: 'Prefer named exports over default exports',
      },
      // non-obvious project knowledge → keeps credit
      {
        fragmentType: 'MEMORY',
        fragmentId: 'real',
        content:
          'Prisma NOT on a nullable Boolean compiles to <> true and skips NULL rows',
      },
    ]
    const used = [
      {
        fragmentType: 'MEMORY' as const,
        fragmentId: 'dup',
        evidence: 'e',
        value: 'HIGH' as const,
      },
      {
        fragmentType: 'MEMORY' as const,
        fragmentId: 'real',
        evidence: 'e',
        value: 'HIGH' as const,
      },
    ]
    const credited = applyMarginalValueGate(used, frags, CLAUDE_MD)
    expect(credited.map(u => u.fragmentId)).toEqual(['real'])
  })

  it('withholds credit for a LOW-graded use even when not constitution-redundant', () => {
    const frags: JudgeFragment[] = [
      { fragmentType: 'MEMORY', fragmentId: 'x', content: 'something novel' },
    ]
    const credited = applyMarginalValueGate(
      [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'x',
          evidence: 'e',
          value: 'LOW',
        },
      ],
      frags,
      null
    )
    expect(credited).toHaveLength(0)
  })

  it('LUM-589: a used fragment whose grade the model omitted earns no credit', () => {
    // Real schema parse applies the default-LOW; real gate filters it out.
    // No mock — this is the end-to-end of the default-LOW fix (a weak-schema
    // model omitting the grade must not inflate the trust flywheel).
    const frags: JudgeFragment[] = [
      {
        fragmentType: 'MEMORY',
        fragmentId: 'x',
        content: 'something novel, not in CLAUDE.md',
      },
    ]
    const parsed = usageJudgeSchema.parse({
      used: [{ fragmentType: 'MEMORY', fragmentId: 'x', evidence: 'e' }],
    })
    const credited = applyMarginalValueGate(parsed.used, frags, null)
    expect(credited).toHaveLength(0)
  })

  it('keeps HIGH credit when there is no constitution (fail-open)', () => {
    const frags: JudgeFragment[] = [
      { fragmentType: 'MEMORY', fragmentId: 'x', content: 'anything' },
    ]
    const credited = applyMarginalValueGate(
      [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'x',
          evidence: 'e',
          value: 'HIGH',
        },
      ],
      frags,
      null
    )
    expect(credited).toHaveLength(1)
  })

  it('judgeFragmentUsage drops constitution-redundant used fragments end to end', async () => {
    const generateObjectMock = generateObject as jest.Mock
    const frags: JudgeFragment[] = [
      {
        fragmentType: 'MEMORY',
        fragmentId: 'dup',
        content: 'Prefer named exports over default exports',
      },
    ]
    generateObjectMock.mockResolvedValue({
      object: {
        used: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'dup',
            evidence: 'e',
            value: 'HIGH',
          },
        ],
        unused: [],
      },
    })
    const out = await judgeFragmentUsage({
      taskTitle: 't',
      fragments: frags,
      eventLog: 'work',
      constitution: CLAUDE_MD,
    })
    expect(out.used).toHaveLength(0)
  })
})

describe('judgeFragmentUsage', () => {
  const generateObjectMock = generateObject as jest.Mock

  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('returns both used and confidently-unused sets', async () => {
    const testFragments: JudgeFragment[] = [
      {
        fragmentType: 'MEMORY',
        fragmentId: 'a',
        content: 'Prisma drift workaround',
      },
      {
        fragmentType: 'WEB_LINK',
        fragmentId: 'b',
        content: 'Neon pooling docs',
      },
    ]
    generateObjectMock.mockResolvedValue({
      object: {
        used: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'a',
            evidence: 'agent ran prisma db execute',
          },
        ],
        unused: [
          {
            fragmentType: 'WEB_LINK',
            fragmentId: 'b',
            evidence:
              'log shows no neon pooling work despite connection setup task',
          },
        ],
      },
    })
    const out = await judgeFragmentUsage({
      taskTitle: 't',
      fragments: testFragments,
      eventLog: 'work...',
    })
    expect(out.used.map(u => u.fragmentId)).toContain('a')
    expect(out.unused.map(u => u.fragmentId)).toContain('b')
  })

  it('filters hallucinated handles out of both lists', async () => {
    const testFragments: JudgeFragment[] = [
      { fragmentType: 'MEMORY', fragmentId: 'real', content: 'real content' },
    ]
    generateObjectMock.mockResolvedValue({
      object: {
        used: [
          {
            fragmentType: 'MEMORY',
            fragmentId: 'real',
            evidence: 'agent used it',
          },
          {
            fragmentType: 'MEMORY',
            fragmentId: 'hallucinated',
            evidence: 'invented',
          },
        ],
        unused: [
          {
            fragmentType: 'SESSION',
            fragmentId: 'ghost',
            evidence: 'never existed',
          },
        ],
      },
    })
    const out = await judgeFragmentUsage({
      taskTitle: 't',
      fragments: testFragments,
      eventLog: 'work',
    })
    expect(out.used.map(u => u.fragmentId)).toEqual(['real'])
    expect(out.unused).toHaveLength(0)
  })

  it('returns empty used and unused on empty fragments', async () => {
    const out = await judgeFragmentUsage({
      taskTitle: 't',
      fragments: [],
      eventLog: 'work',
    })
    expect(out.used).toHaveLength(0)
    expect(out.unused).toHaveLength(0)
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('returns empty used and unused on model error', async () => {
    const testFragments: JudgeFragment[] = [
      { fragmentType: 'MEMORY', fragmentId: 'm1', content: 'content' },
    ]
    generateObjectMock.mockRejectedValue(new Error('model unavailable'))
    const out = await judgeFragmentUsage({
      taskTitle: 't',
      fragments: testFragments,
      eventLog: 'work',
    })
    expect(out.used).toHaveLength(0)
    expect(out.unused).toHaveLength(0)
  })
})
