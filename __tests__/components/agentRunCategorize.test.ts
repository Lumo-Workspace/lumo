import { HookEventType } from '@prisma/client'
import {
  CATEGORY_STYLE,
  categorizeHookEvent,
} from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/categorize'
import type { AgentRunHookEventItem } from '@/app/workspace/[workspaceUrl]/types'

function makeEvent(type: string): AgentRunHookEventItem {
  return {
    id: 'evt_1',
    kind: 'hook',
    // cast: the point of the test is that the runtime type may be any
    // HookEventType value the backend stores, not just the frontend union.
    type: type as AgentRunHookEventItem['type'],
    toolName: null,
    payload: {},
    turnSummary: null,
    createdAt: new Date('2026-05-29T10:00:00Z').toISOString(),
  }
}

describe('categorizeHookEvent', () => {
  // The backend (agent-run-timeline.service) forwards the raw Prisma
  // HookEventType verbatim, so every enum value must resolve to a style with a
  // defined `dot` — otherwise AgentRunEventRow crashes on `style.dot`.
  it.each(Object.values(HookEventType))(
    'maps %s to a style with a defined dot',
    type => {
      const category = categorizeHookEvent(makeEvent(type))
      const style = CATEGORY_STYLE[category]
      expect(style).toBeDefined()
      expect(typeof style.dot).toBe('string')
      expect(style.dot.length).toBeGreaterThan(0)
    }
  )

  // Defense in depth: a HookEventType value added to the DB enum before the
  // frontend is updated must still render, not throw.
  it('falls back to a valid style for an unknown event type', () => {
    const category = categorizeHookEvent(makeEvent('SOME_FUTURE_EVENT'))
    const style = CATEGORY_STYLE[category]
    expect(style).toBeDefined()
    expect(typeof style.dot).toBe('string')
  })
})
