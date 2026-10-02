/**
 * @jest-environment node
 */
import {
  buildChildSessionId,
  parseChildSessionId,
} from '@/lib/session/child-session-id'

describe('child session id', () => {
  it('round-trips parent and agent id', () => {
    const id = buildChildSessionId(
      'd59fb7f9-1244-45c5-a9ae-35797dbcfc3b',
      'abeaba01ea909a7ee'
    )
    expect(id).toBe('d59fb7f9-1244-45c5-a9ae-35797dbcfc3b:abeaba01ea909a7ee')
    expect(parseChildSessionId(id)).toEqual({
      parentSessionId: 'd59fb7f9-1244-45c5-a9ae-35797dbcfc3b',
      agentId: 'abeaba01ea909a7ee',
    })
  })

  it('returns null for a top-level session id', () => {
    expect(
      parseChildSessionId('d59fb7f9-1244-45c5-a9ae-35797dbcfc3b')
    ).toBeNull()
  })

  it('rejects malformed agent ids', () => {
    expect(() => buildChildSessionId('p', 'a;rm -rf')).toThrow()
    expect(parseChildSessionId('p:a b')).toBeNull()
    expect(parseChildSessionId(':abc')).toBeNull()
  })
})
