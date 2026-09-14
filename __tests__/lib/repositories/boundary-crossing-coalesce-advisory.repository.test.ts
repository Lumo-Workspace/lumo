/**
 * @jest-environment node
 *
 * LUM-779 — a coalescing recurrence must not cross the advisory line. Once a
 * TEST_FILE_DELETED can be recorded advisory (probe said nothing tracked was
 * missing), an OPEN advisory row for `rm __tests__/x.test.ts` must not absorb
 * a later BLOCKING recurrence of the same segment (the file got committed,
 * then really deleted) — that would swallow the true positive behind the
 * false one. So `coalesceRecurrence` keys on `advisory` when the caller says
 * which side it is on; legacy callers that pass nothing keep the old key.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

const updateMany = prisma.boundaryCrossing.updateMany as jest.Mock
const now = new Date('2026-09-14T00:00:00Z')

beforeEach(() => updateMany.mockClear())

it('LUM-779: a blocking recurrence only coalesces with an OPEN blocking row of the same key', async () => {
  await boundaryCrossingRepository.coalesceRecurrence(
    't1',
    'TEST_FILE_DELETED',
    'rm __tests__/x.test.ts',
    now,
    false
  )
  expect(updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        taskId: 't1',
        category: 'TEST_FILE_DELETED',
        target: 'rm __tests__/x.test.ts',
        disposition: null,
        advisory: false,
      },
    })
  )
})

it('LUM-779: an advisory recurrence only coalesces with an OPEN advisory row of the same key', async () => {
  await boundaryCrossingRepository.coalesceRecurrence(
    't1',
    'TEST_FILE_DELETED',
    'rm __tests__/x.test.ts',
    now,
    true
  )
  expect(updateMany.mock.calls[0]![0].where).toMatchObject({ advisory: true })
})

it('a caller that does not say which side it is on keeps the legacy key (no advisory clause)', async () => {
  await boundaryCrossingRepository.coalesceRecurrence(
    't1',
    'SESSION_BINDING_MISSING',
    'unbound',
    now
  )
  expect(updateMany.mock.calls[0]![0].where).not.toHaveProperty('advisory')
})
