import { generateObject } from 'ai'

jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  buildUsageJudgePrompt,
  judgeFragmentUsage,
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

  it('schema accepts confident-used refs and rejects unknown fragmentType', () => {
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
    const bad = usageJudgeSchema.safeParse({
      used: [{ fragmentType: 'NOPE', fragmentId: 'x', evidence: 'e' }],
    })
    expect(bad.success).toBe(false)
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
