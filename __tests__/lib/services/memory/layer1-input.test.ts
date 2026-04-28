/**
 * @jest-environment node
 */
import type { RawEvent } from '@/lib/services/session-summary/compact-events'
import { extractCurrentTurn } from '@/lib/services/memory/layer1-input'

const ev = (
  i: number,
  type: RawEvent['type'],
  toolName: string | null = null
): RawEvent => ({
  id: `ev_${i}`,
  type,
  toolName,
  payload: {},
  createdAt: new Date(`2026-04-27T10:${String(i).padStart(2, '0')}:00Z`),
})

describe('extractCurrentTurn', () => {
  it('returns the entire stream up to (and including) the only STOP', () => {
    const events = [
      ev(0, 'PRE_TOOL_USE', 'Read'),
      ev(1, 'POST_TOOL_USE', 'Read'),
      ev(2, 'STOP'),
    ]
    expect(extractCurrentTurn(events).map(e => e.id)).toEqual([
      'ev_0',
      'ev_1',
      'ev_2',
    ])
  })

  it('returns only the events after the previous STOP through the latest STOP', () => {
    const events = [
      ev(0, 'PRE_TOOL_USE', 'Read'),
      ev(1, 'STOP'),
      ev(2, 'PRE_TOOL_USE', 'Bash'),
      ev(3, 'POST_TOOL_USE', 'Bash'),
      ev(4, 'STOP'),
    ]
    expect(extractCurrentTurn(events).map(e => e.id)).toEqual([
      'ev_2',
      'ev_3',
      'ev_4',
    ])
  })

  it('returns an empty list when no STOP exists', () => {
    const events = [
      ev(0, 'PRE_TOOL_USE', 'Read'),
      ev(1, 'POST_TOOL_USE', 'Read'),
    ]
    expect(extractCurrentTurn(events)).toEqual([])
  })

  it('returns just the latest STOP when two STOPs are adjacent (empty turn in between)', () => {
    const events = [ev(0, 'STOP'), ev(1, 'STOP')]
    expect(extractCurrentTurn(events).map(e => e.id)).toEqual(['ev_1'])
  })
})
