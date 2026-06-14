import { classifyBinding } from '@/lib/services/session-binding-guard'
import { sessionRepository } from '@/lib/repositories/session.repository'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findForMemberWithBinding: jest.fn() },
}))

const findBinding = sessionRepository.findForMemberWithBinding as jest.Mock

const boundTo = (
  id: string,
  identifier = 'LUM-1',
  number = 1,
  title = 'T'
) => ({
  id: 'sess',
  task: { id, title, number, team: { identifier } },
})

beforeEach(() => jest.clearAllMocks())

describe('classifyBinding', () => {
  it('skips the clerk (human web) path without any repo call — RED LINE', async () => {
    const r = await classifyBinding({
      source: 'clerk',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'ok' })
    expect(findBinding).not.toHaveBeenCalled()
  })
  it('returns unconfirmed (no repo call) when the session header is absent', async () => {
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: null,
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'unconfirmed' })
    expect(findBinding).not.toHaveBeenCalled()
  })
  it('returns unconfirmed when the session row cannot be resolved', async () => {
    findBinding.mockResolvedValue(null)
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'unconfirmed' })
  })
  it('returns unbound when the session resolves but has no task binding', async () => {
    findBinding.mockResolvedValue({ id: 'sess', task: null })
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'unbound' })
  })
  it('returns ok when the session is bound to the target task', async () => {
    findBinding.mockResolvedValue(boundTo('t1'))
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'ok' })
  })
  it('returns mismatch with the bound identifier/title when bound elsewhere', async () => {
    findBinding.mockResolvedValue(boundTo('t2', 'LUM', 487, 'Other task'))
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({
      kind: 'mismatch',
      boundIdentifier: 'LUM-487',
      boundTitle: 'Other task',
    })
  })
})
