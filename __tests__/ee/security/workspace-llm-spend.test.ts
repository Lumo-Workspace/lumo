import { workspaceLlmSpendRepository } from '@/ee/security/repositories/workspace-llm-spend.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceLlmSpend: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

const mockPrisma = prisma as unknown as {
  workspaceLlmSpend: { findUnique: jest.Mock; upsert: jest.Mock }
}

beforeEach(() => jest.clearAllMocks())

describe('workspaceLlmSpendRepository.monthSpendUsd', () => {
  it('reads the UTC month row and converts micros to USD', async () => {
    mockPrisma.workspaceLlmSpend.findUnique.mockResolvedValue({
      usdMicros: BigInt(12_345_000),
    })
    const usd = await workspaceLlmSpendRepository.monthSpendUsd(
      'ws1',
      'reward_hack',
      new Date('2026-10-31T23:59:00Z')
    )
    expect(usd).toBeCloseTo(12.345)
    expect(mockPrisma.workspaceLlmSpend.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_feature_month: {
            workspaceId: 'ws1',
            feature: 'reward_hack',
            month: '2026-10',
          },
        },
      })
    )
  })

  it('rolls over to the next month right after the UTC boundary', async () => {
    mockPrisma.workspaceLlmSpend.findUnique.mockResolvedValue(null)
    await workspaceLlmSpendRepository.monthSpendUsd(
      'ws1',
      'reward_hack',
      new Date('2026-11-01T00:00:00Z')
    )
    expect(
      mockPrisma.workspaceLlmSpend.findUnique.mock.calls[0][0].where
        .workspaceId_feature_month.month
    ).toBe('2026-11')
  })

  it('returns 0 when there is no row', async () => {
    mockPrisma.workspaceLlmSpend.findUnique.mockResolvedValue(null)
    expect(
      await workspaceLlmSpendRepository.monthSpendUsd(
        'ws1',
        'reward_hack',
        new Date('2026-10-05T00:00:00Z')
      )
    ).toBe(0)
  })
})

describe('workspaceLlmSpendRepository.addSpendUsd', () => {
  it('upserts with an atomic increment of micros under the UTC month key', async () => {
    mockPrisma.workspaceLlmSpend.upsert.mockResolvedValue({})
    await workspaceLlmSpendRepository.addSpendUsd(
      'ws1',
      'reward_hack',
      0.5,
      new Date('2026-10-31T23:59:00Z')
    )
    expect(mockPrisma.workspaceLlmSpend.upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_feature_month: {
          workspaceId: 'ws1',
          feature: 'reward_hack',
          month: '2026-10',
        },
      },
      create: {
        workspaceId: 'ws1',
        feature: 'reward_hack',
        month: '2026-10',
        usdMicros: BigInt(500_000),
      },
      update: { usdMicros: { increment: BigInt(500_000) } },
    })
  })

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'does not write for amount %p',
    async amount => {
      await workspaceLlmSpendRepository.addSpendUsd(
        'ws1',
        'reward_hack',
        amount,
        new Date('2026-10-05T00:00:00Z')
      )
      expect(mockPrisma.workspaceLlmSpend.upsert).not.toHaveBeenCalled()
    }
  )

  it('does not write when the amount rounds to zero micros', async () => {
    await workspaceLlmSpendRepository.addSpendUsd(
      'ws1',
      'reward_hack',
      1e-9,
      new Date('2026-10-05T00:00:00Z')
    )
    expect(mockPrisma.workspaceLlmSpend.upsert).not.toHaveBeenCalled()
  })
})
