/**
 * LUM-455 read-model additions on the edit-change view:
 *  - prFileUrl: a deep link straight to the changed file's diff inside the PR.
 *  - turnContextForEvent: the summary of the turn an edit belongs to (the
 *    closest available proxy for a per-edit reason).
 */
import { createHash } from 'crypto'
import {
  buildEditChangeView,
  turnContextForEvent,
} from '@/lib/services/boundary-crossing.service'

const PR = 'https://github.com/acme/repo/pull/42'
const editEvent = (over: Record<string, unknown> = {}) => ({
  toolName: 'Edit',
  payload: {
    tool_input: { old_string: 'toBe(1)', new_string: 'toBe(2)' },
  },
  ...over,
})

describe('buildEditChangeView — PR file deep link (LUM-455)', () => {
  it('points prFileUrl at the file diff anchor when the path is known', () => {
    const path = '__tests__/widget.test.ts'
    const anchor = createHash('sha256').update(path).digest('hex')
    const view = buildEditChangeView('TEST_TAMPERING', editEvent(), PR, path)
    expect(view!.prFileUrl).toBe(`${PR}/files#diff-${anchor}`)
  })

  it('falls back to the PR Files tab when the path is unknown, and null with no PR', () => {
    expect(
      buildEditChangeView('TEST_TAMPERING', editEvent(), PR)!.prFileUrl
    ).toBe(`${PR}/files`)
    expect(
      buildEditChangeView('TEST_TAMPERING', editEvent(), null, 'a.test.ts')!
        .prFileUrl
    ).toBeNull()
  })

  it('carries the agent turn context through to the view', () => {
    const view = buildEditChangeView(
      'TEST_TAMPERING',
      editEvent(),
      PR,
      'a.test.ts',
      'Fixed the rounding bug'
    )
    expect(view!.agentTurnContext).toBe('Fixed the rounding bug')
  })
})

describe('turnContextForEvent — turn an edit belongs to (LUM-455)', () => {
  const stops = [
    {
      sessionId: 's1',
      createdAt: '2026-06-12T00:00:10Z',
      turnSummary: 'turn A',
    },
    {
      sessionId: 's1',
      createdAt: '2026-06-12T00:00:30Z',
      turnSummary: 'turn B',
    },
    {
      sessionId: 's2',
      createdAt: '2026-06-12T00:00:30Z',
      turnSummary: 'other session',
    },
  ]

  it('picks the earliest STOP at/after the edit in the same session', () => {
    const event = {
      toolName: 'Edit',
      payload: {},
      sessionId: 's1',
      createdAt: '2026-06-12T00:00:20Z',
    }
    // Edit at :20 → the next STOP that ends its turn is :30 (turn B), not :10.
    expect(turnContextForEvent(event, stops)).toBe('turn B')
  })

  it('returns null when the session/time is unknown or no later STOP exists', () => {
    expect(turnContextForEvent(null, stops)).toBeNull()
    expect(
      turnContextForEvent({ toolName: 'Edit', payload: {} }, stops)
    ).toBeNull()
    // An edit after every STOP in the session → no bounding summary yet.
    expect(
      turnContextForEvent(
        {
          toolName: 'Edit',
          payload: {},
          sessionId: 's1',
          createdAt: '2026-06-12T01:00:00Z',
        },
        stops
      )
    ).toBeNull()
  })
})
