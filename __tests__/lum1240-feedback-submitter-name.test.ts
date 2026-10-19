/**
 * @jest-environment node
 *
 * LUM-1240 batch 2 (follow-up to a review finding on #1618): a feedback
 * submitter whose name cannot be resolved shows as "Unknown member" — never
 * the internal member id (or the raw directory user id) — while every other
 * labelsByIds caller keeps its id fallback.
 */
const findMany = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}))
const getUserList = jest.fn()
jest.mock('@/lib/auth/users', () => ({
  createUserDirectory: async () => ({ getUserList }),
}))

import { memberRepository } from '@/lib/repositories/member.repository'
import {
  memberNames,
  submitter,
  UNKNOWN_MEMBER,
} from '@/lib/services/feedback.service'

const user = (
  id: string,
  first: string | null,
  email: string | null
): Record<string, unknown> => ({
  id,
  firstName: first,
  lastName: null,
  primaryEmailAddressId: email ? 'e1' : null,
  emailAddresses: email ? [{ id: 'e1', emailAddress: email }] : [],
})

beforeEach(() => {
  jest.clearAllMocks()
  findMany.mockResolvedValue([
    { id: 'cmember-named', clerkId: 'user_1' },
    { id: 'cmember-email', clerkId: 'user_2' },
    { id: 'cmember-blank', clerkId: 'user_3' },
    { id: 'cmember-gone', clerkId: 'user_4' },
  ])
  getUserList.mockResolvedValue({
    data: [
      user('user_1', 'Ada', 'ada@x.com'),
      user('user_2', null, 'bob@x.com'),
      user('user_3', null, null),
    ],
  })
})

const IDS = ['cmember-named', 'cmember-email', 'cmember-blank', 'cmember-gone']

describe('labelsByIds', () => {
  it('default: every id gets a label, falling back to ids', async () => {
    const labels = await memberRepository.labelsByIds(IDS)
    expect([...labels]).toEqual([
      ['cmember-named', 'Ada'],
      ['cmember-email', 'bob'],
      ['cmember-blank', 'user_3'],
      ['cmember-gone', 'cmember-gone'],
    ])
  })

  it("unresolved: 'omit' keeps only names and emails", async () => {
    const labels = await memberRepository.labelsByIds(IDS, {
      unresolved: 'omit',
    })
    expect([...labels]).toEqual([
      ['cmember-named', 'Ada'],
      ['cmember-email', 'bob'],
    ])
  })

  it("unresolved: 'omit' with the directory down: an empty map", async () => {
    getUserList.mockRejectedValue(new Error('down'))
    expect(
      (await memberRepository.labelsByIds(IDS, { unresolved: 'omit' })).size
    ).toBe(0)
  })
})

describe('feedback submitter name', () => {
  it('a resolved name is used; anything else is "Unknown member", never the id', async () => {
    const names = await memberNames(IDS)
    expect(submitter('cmember-named', names)).toEqual({ name: 'Ada' })
    expect(submitter('cmember-email', names)).toEqual({ name: 'bob' })
    for (const id of ['cmember-blank', 'cmember-gone'])
      expect(submitter(id, names)).toEqual({ name: UNKNOWN_MEMBER })
    expect(submitter(null, names)).toBeNull()
  })
})
