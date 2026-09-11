/** @jest-environment node */
// LUM-758 review finding: the zod schema (`z.array(z.enum(...)).max(2)`)
// permits duplicates like `['idor','idor']`. Undeduped, the orchestrator
// treats that as two planned categories and runs pass 1 twice on `idor` —
// and the retry pass can double that again, spending the whole scan budget
// on one category while `audit.planned` persists the duplicate too.
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { generateObject } from 'ai'
import { planHuntCategories } from '@/lib/llm/security-hunt-plan-client'

const gen = generateObject as jest.Mock

const INPUT = {
  reasons: ['diff:sink:prisma-raw'],
  files: [{ path: 'a.ts', touched: true }],
  signals: [],
  findings: [],
  timeoutMs: 5_000,
}

describe('LUM-758 hunt plan client', () => {
  it('dedupes a model response that repeats a category', async () => {
    gen.mockResolvedValueOnce({
      object: {
        categories: ['idor', 'idor'],
        reason: 'unchecked workspace id',
      },
      usage: { totalTokens: 300 },
    })

    const out = await planHuntCategories(INPUT)

    expect(out.categories).toEqual(['idor'])
  })

  it('dedupes before applying the max-categories cap', async () => {
    gen.mockResolvedValueOnce({
      object: {
        categories: ['idor', 'idor', 'injection'],
        reason: 'multiple signals',
      },
      usage: { totalTokens: 300 },
    })

    const out = await planHuntCategories(INPUT)

    expect(out.categories).toEqual(['idor', 'injection'])
  })
})
