/**
 * @jest-environment node
 */
import {
  allowedTaskTransitions,
  invalidTransitionMessage,
  isValidTaskTransition,
} from '@/lib/task/state-machine'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))

describe('allowedTaskTransitions', () => {
  it('mirrors the transition matrix', () => {
    expect(allowedTaskTransitions('TODO')).toEqual([
      'BACKLOG',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
    // LUM-586: DONE → IN_REVIEW is now legal so that undoing an acceptance
    // verdict can send a DONE task back to IN_REVIEW via the state machine.
    expect(allowedTaskTransitions('DONE')).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
    ])
  })

  it('agrees with isValidTaskTransition for every pair', () => {
    const statuses = [
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ] as const
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to) continue
        expect(allowedTaskTransitions(from).includes(to)).toBe(
          isValidTaskTransition(from, to)
        )
      }
    }
  })

  // LUM-586: new first-class transition
  it('DONE → IN_REVIEW is valid (undo of acceptance verdict path)', () => {
    expect(isValidTaskTransition('DONE', 'IN_REVIEW')).toBe(true)
  })
})

describe('invalidTransitionMessage', () => {
  it('names the allowed targets so the caller can self-correct', () => {
    // Use a status that still has invalid targets — IN_REVIEW can only go to
    // TODO, IN_PROGRESS, DONE; so IN_REVIEW → IN_REVIEW is invalid.
    const msg = invalidTransitionMessage('IN_REVIEW', 'IN_REVIEW')
    expect(msg).toContain('Invalid status transition: IN_REVIEW → IN_REVIEW')
    expect(msg).toContain('Allowed from IN_REVIEW:')
  })

  it('formats the message with from → to and the allowed list', () => {
    const msg = invalidTransitionMessage('DONE', 'DONE')
    expect(msg).toContain('Invalid status transition: DONE → DONE')
    expect(msg).toContain(
      'Allowed from DONE: BACKLOG, TODO, IN_PROGRESS, IN_REVIEW'
    )
  })
})
