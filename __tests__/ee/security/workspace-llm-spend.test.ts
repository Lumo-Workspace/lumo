import { workspaceLlmSpendRepository } from '@/ee/security/repositories/workspace-llm-spend.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceLlmSpend: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))

const mockPrisma = prisma as unknown as {
  workspaceLlmSpend: {
    findUnique: jest.Mock
    upsert: jest.Mock
    updateMany: jest.Mock
  }
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
    mockPrisma.workspaceLlmSpend.upsert.mockResolvedValue({
      usdMicros: BigInt(2_500_000),
    })
    const total = await workspaceLlmSpendRepository.addSpendUsd(
      'ws1',
      'reward_hack',
      0.5,
      new Date('2026-10-31T23:59:00Z')
    )
    // The month total after the write, for the caller's cap check.
    expect(total).toBe(2.5)
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
      select: { usdMicros: true },
    })
  })

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'does not write for amount %p',
    async amount => {
      expect(
        await workspaceLlmSpendRepository.addSpendUsd(
          'ws1',
          'reward_hack',
          amount,
          new Date('2026-10-05T00:00:00Z')
        )
      ).toBeNull()
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

describe('workspaceLlmSpendRepository.refundSpendUsd', () => {
  it('decrements the existing month row only (never creates one)', async () => {
    mockPrisma.workspaceLlmSpend.updateMany.mockResolvedValue({ count: 1 })
    await workspaceLlmSpendRepository.refundSpendUsd(
      'ws1',
      'reward_hack',
      0.25,
      new Date('2026-10-05T00:00:00Z')
    )
    expect(mockPrisma.workspaceLlmSpend.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1', feature: 'reward_hack', month: '2026-10' },
      data: { usdMicros: { decrement: BigInt(250_000) } },
    })
    expect(mockPrisma.workspaceLlmSpend.upsert).not.toHaveBeenCalled()
  })

  it.each([0, -1, NaN])('does not write for amount %p', async amount => {
    await workspaceLlmSpendRepository.refundSpendUsd(
      'ws1',
      'reward_hack',
      amount,
      new Date('2026-10-05T00:00:00Z')
    )
    expect(mockPrisma.workspaceLlmSpend.updateMany).not.toHaveBeenCalled()
  })
})
