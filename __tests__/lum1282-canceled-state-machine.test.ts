/**
 * @jest-environment node
 *
 * LUM-1282: CANCELED in the state machine — a gated (human-ruled) status, a
 * terminal stamp pair (completedAt / canceledAt) and the shared status
 * semantics every read model uses.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: { task: {} } }))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))

import {
  allowedTaskTransitions,
  isGatedStatus,
  isValidTaskTransition,
  taskWorkflowCatalog,
  terminalTimestampPatch,
} from '@/lib/task/state-machine'
import {
  CLOSED_TASK_STATUSES,
  COUNTED_TASK_STATUSES,
  OPEN_TASK_STATUSES,
  countsTowardCompletion,
  isClosedTaskStatus,
} from '@/lib/task/status-semantics'
import { isWorkStartedStatus } from '@/lib/task/work-started'
import { terminalStampsForMove } from '@/mcp/status-stamps'

const NOW = new Date('2026-10-19T12:00:00.000Z')

describe('CANCELED transitions and gating', () => {
  it('every status can move to CANCELED, and CANCELED reopens to any other', () => {
    for (const from of [
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ] as const) {
      expect(isValidTaskTransition(from, 'CANCELED')).toBe(true)
      expect(isValidTaskTransition('CANCELED', from)).toBe(true)
    }
    expect(allowedTaskTransitions('CANCELED')).not.toContain('CANCELED')
  })

  it('the workflow catalog lists CANCELED and gates it next to DONE', () => {
    const c = taskWorkflowCatalog()
    expect(c.statuses.map(s => s.value)).toContain('CANCELED')
    expect(c.gatedStatuses).toEqual(['DONE', 'CANCELED'])
    expect(isGatedStatus('CANCELED')).toBe(true)
    expect(isGatedStatus('DONE')).toBe(true)
    expect(isGatedStatus('IN_REVIEW')).toBe(false)
  })

  it('canceling is not a start of work', () => {
    expect(isWorkStartedStatus('CANCELED')).toBe(false)
  })
})

describe('terminalTimestampPatch', () => {
  it('stamps canceledAt on entering CANCELED and clears it on reopen', () => {
    expect(terminalTimestampPatch('TODO', 'CANCELED', NOW)).toEqual({
      canceledAt: NOW,
    })
    expect(terminalTimestampPatch('CANCELED', 'TODO', NOW)).toEqual({
      canceledAt: null,
    })
  })

  it('stamps completedAt on entering DONE and clears it on reopen', () => {
    expect(terminalTimestampPatch('IN_REVIEW', 'DONE', NOW)).toEqual({
      completedAt: NOW,
    })
    expect(terminalTimestampPatch('DONE', 'IN_PROGRESS', NOW)).toEqual({
      completedAt: null,
    })
  })

  it('DONE ↔ CANCELED swaps the stamps', () => {
    expect(terminalTimestampPatch('DONE', 'CANCELED', NOW)).toEqual({
      completedAt: null,
      canceledAt: NOW,
    })
    expect(terminalTimestampPatch('CANCELED', 'DONE', NOW)).toEqual({
      completedAt: NOW,
      canceledAt: null,
    })
  })

  it('moves outside the terminal statuses and no-ops write nothing', () => {
    expect(terminalTimestampPatch('TODO', 'IN_PROGRESS', NOW)).toEqual({})
    expect(terminalTimestampPatch('DONE', 'DONE', NOW)).toEqual({})
    expect(terminalTimestampPatch('CANCELED', 'CANCELED', NOW)).toEqual({})
  })

  it('the MCP copy agrees, and never stamps canceledAt (MCP cannot cancel)', () => {
    expect(terminalStampsForMove('TODO', 'DONE', NOW)).toEqual({
      completedAt: NOW,
    })
    expect(terminalStampsForMove('DONE', 'TODO', NOW)).toEqual({
      completedAt: null,
    })
    expect(terminalStampsForMove('CANCELED', 'TODO', NOW)).toEqual({
      canceledAt: null,
    })
    expect(terminalStampsForMove('TODO', 'TODO', NOW)).toEqual({})
  })
})

describe('status semantics', () => {
  it('closed = DONE + CANCELED; open = the rest', () => {
    expect([...CLOSED_TASK_STATUSES]).toEqual(['DONE', 'CANCELED'])
    expect(OPEN_TASK_STATUSES).not.toContain('CANCELED')
    expect(isClosedTaskStatus('CANCELED')).toBe(true)
    expect(isClosedTaskStatus('DONE')).toBe(true)
    expect(isClosedTaskStatus('IN_REVIEW')).toBe(false)
  })

  it('CANCELED is the only status outside completion metrics', () => {
    expect(COUNTED_TASK_STATUSES).not.toContain('CANCELED')
    expect(countsTowardCompletion('CANCELED')).toBe(false)
    expect(countsTowardCompletion('DONE')).toBe(true)
    expect(countsTowardCompletion('BACKLOG')).toBe(true)
  })
})
