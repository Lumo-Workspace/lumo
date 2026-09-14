/**
 * @jest-environment node
 *
 * LUM-771 — two disposition read/write defects:
 *
 *  1. A human ruling on a rule-suppressed crossing must clear its
 *     `suppressionRuleId`; otherwise the list view keeps reporting the rule and
 *     the panel shows "auto-dispositioned by rule … Revoke rule" on a row the
 *     human has since ruled on (contradicting the vanished AUTO_SUPPRESSED badge).
 *  2. `lastDispositionChange` must recognise a system ruling (AUTO_SUPPRESSED /
 *     AUTO_LEGIT) as the `from` of a human correction; before this fix such a
 *     `from` normalised to null and the correction read as an initial ruling.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { lastDispositionChange } from '@/lib/services/boundary-crossing.service'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  },
}))

const updateMany = prisma.boundaryCrossing.updateMany as unknown as jest.Mock

describe('LUM-771 human disposition clears suppressionRuleId', () => {
  beforeEach(() => updateMany.mockClear())

  it('a CONFIRMED ruling writes suppressionRuleId: null', async () => {
    await boundaryCrossingRepository.disposition(
      'cx-1',
      'CONFIRMED',
      'real',
      'member-1',
      new Date('2026-09-14T00:00:00Z')
    )
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({
      disposition: 'CONFIRMED',
      suppressionRuleId: null,
    })
  })

  it('a FALSE_POSITIVE ruling writes suppressionRuleId: null', async () => {
    await boundaryCrossingRepository.disposition(
      'cx-1',
      'FALSE_POSITIVE',
      null,
      'member-1',
      new Date()
    )
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({
      suppressionRuleId: null,
    })
  })

  it('reopening (disposition null) writes suppressionRuleId: null', async () => {
    await boundaryCrossingRepository.disposition(
      'cx-1',
      null,
      null,
      'member-1',
      new Date()
    )
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({
      disposition: null,
      suppressionRuleId: null,
    })
  })
})

describe('LUM-771 readTransition keeps system rulings as corrections', () => {
  const at = new Date('2026-09-14T10:00:00Z')

  it('AUTO_SUPPRESSED → CONFIRMED is a correction from AUTO_SUPPRESSED', () => {
    const change = lastDispositionChange([
      {
        payload: {
          boundaryCrossingId: 'cx',
          from: 'AUTO_SUPPRESSED',
          to: 'CONFIRMED',
        },
        actorId: 'member-1',
        createdAt: at,
      },
    ])
    expect(change).not.toBeNull()
    expect(change).toMatchObject({ from: 'AUTO_SUPPRESSED', to: 'CONFIRMED' })
  })

  it('AUTO_LEGIT → FALSE_POSITIVE is a correction from AUTO_LEGIT', () => {
    const change = lastDispositionChange([
      {
        payload: {
          boundaryCrossingId: 'cx',
          from: 'AUTO_LEGIT',
          to: 'FALSE_POSITIVE',
        },
        actorId: 'member-1',
        createdAt: at,
      },
    ])
    expect(change).toMatchObject({ from: 'AUTO_LEGIT', to: 'FALSE_POSITIVE' })
  })

  it('a rule revoke (AUTO_SUPPRESSED → open) is a correction back to null', () => {
    const change = lastDispositionChange([
      {
        payload: {
          boundaryCrossingId: 'cx',
          from: 'AUTO_SUPPRESSED',
          to: null,
        },
        actorId: null,
        createdAt: at,
      },
    ])
    expect(change).toMatchObject({ from: 'AUTO_SUPPRESSED', to: null })
  })

  it('an initial ruling (from null) is still not a correction', () => {
    expect(
      lastDispositionChange([
        {
          payload: { boundaryCrossingId: 'cx', from: null, to: 'CONFIRMED' },
          actorId: 'member-1',
          createdAt: at,
        },
      ])
    ).toBeNull()
  })
})
