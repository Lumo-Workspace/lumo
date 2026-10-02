const mockFind = jest.fn()
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findForMemberWithBinding: (...a: unknown[]) => mockFind(...a),
  },
}))

import { resolveEffectiveBindingSession } from '@/lib/services/effective-binding-session'

beforeEach(() => mockFind.mockReset())

describe('resolveEffectiveBindingSession', () => {
  it('returns a top-level row as-is without a second read', async () => {
    mockFind.mockResolvedValue({ id: 's', task: null })
    expect(await resolveEffectiveBindingSession('s', 'm')).toEqual({
      id: 's',
      task: null,
    })
    expect(mockFind).toHaveBeenCalledTimes(1)
  })
  it('falls back to the member-scoped parent for an unbound child', async () => {
    mockFind.mockImplementation(async (id: string) =>
      id === 'p:a1' ? { id, task: null } : { id, task: { id: 't1' } }
    )
    expect(await resolveEffectiveBindingSession('p:a1', 'm')).toEqual({
      id: 'p',
      task: { id: 't1' },
    })
    expect(mockFind).toHaveBeenLastCalledWith('p', 'm')
  })
  it('keeps the child when it carries its own task', async () => {
    mockFind.mockResolvedValue({ id: 'p:a1', task: { id: 't2' } })
    expect(await resolveEffectiveBindingSession('p:a1', 'm')).toEqual({
      id: 'p:a1',
      task: { id: 't2' },
    })
    expect(mockFind).toHaveBeenCalledTimes(1)
  })
  it('keeps a child that is STEWARD by its own binding over an unbound parent', async () => {
    const child = {
      id: 'p:a1',
      task: null,
      role: 'STEWARD',
      milestone: { id: 'ms1', name: 'M' },
    }
    mockFind.mockImplementation(async (id: string) =>
      id === 'p:a1' ? child : { id, task: null }
    )
    expect(await resolveEffectiveBindingSession('p:a1', 'm')).toEqual(child)
    expect(mockFind).toHaveBeenCalledTimes(1)
  })
  it('keeps the child row when the parent is not readable for this member', async () => {
    mockFind.mockImplementation(async (id: string) =>
      id === 'p:a1' ? { id, task: null } : null
    )
    expect(await resolveEffectiveBindingSession('p:a1', 'm')).toEqual({
      id: 'p:a1',
      task: null,
    })
  })
})
