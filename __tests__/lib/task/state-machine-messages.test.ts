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
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
    expect(allowedTaskTransitions('DONE')).toEqual(['TODO', 'IN_PROGRESS'])
  })

  it('agrees with isValidTaskTransition for every pair', () => {
    const statuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to) continue
        expect(allowedTaskTransitions(from).includes(to)).toBe(
          isValidTaskTransition(from, to)
        )
      }
    }
  })
})

describe('invalidTransitionMessage', () => {
  it('names the allowed targets so the caller can self-correct', () => {
    const msg = invalidTransitionMessage('DONE', 'IN_REVIEW')
    expect(msg).toContain('Invalid status transition: DONE → IN_REVIEW')
    expect(msg).toContain('Allowed from DONE: TODO, IN_PROGRESS')
  })

  it('points DONE dead ends at task comments', () => {
    expect(invalidTransitionMessage('DONE', 'IN_REVIEW')).toContain(
      'add a task comment instead'
    )
    expect(invalidTransitionMessage('TODO', 'TODO')).not.toContain(
      'task comment'
    )
  })
})
