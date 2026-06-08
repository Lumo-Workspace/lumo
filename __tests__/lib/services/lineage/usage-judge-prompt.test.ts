jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  buildUsageJudgePrompt,
  usageJudgeSchema,
  type JudgeFragment,
} from '@/lib/services/lineage/usage-judge'

const fragments: JudgeFragment[] = [
  { fragmentType: 'MEMORY', fragmentId: 'm1', content: 'Prisma drift workaround: run db execute + migrate resolve' },
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
    // Pin the core safety property: abstain-by-default / never assert "not used".
    expect(system).toMatch(/OMIT|abstain/i)
    expect(system).toMatch(/never output a ['"]?not used/i)
    expect(user).toContain('MEMORY::m1')
    expect(user).toContain('Prisma drift workaround')
    expect(user).toContain('WEB_LINK::w1')
    expect(user).toContain('npx prisma db execute')
  })

  it('schema accepts confident-used refs and rejects unknown fragmentType', () => {
    const ok = usageJudgeSchema.safeParse({
      used: [{ fragmentType: 'MEMORY', fragmentId: 'm1', evidence: 'ran db execute' }],
    })
    expect(ok.success).toBe(true)
    const bad = usageJudgeSchema.safeParse({
      used: [{ fragmentType: 'NOPE', fragmentId: 'x', evidence: 'e' }],
    })
    expect(bad.success).toBe(false)
  })
})
