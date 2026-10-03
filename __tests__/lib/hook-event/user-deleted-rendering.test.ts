/**
 * LUM-944 — a session raw record deleted by hand renders as "raw content
 * deleted" (not "cleared per retention policy") on both timelines, and the
 * marker names who deleted it.
 */
import type { IntlShape } from 'react-intl'
import en from '@/lib/i18n/en.json'
import zhCN from '@/lib/i18n/zh-CN.json'
import { mergeEvents, type RawEvent } from '@/app/sessions/[id]/merge-events'
import { summarizeEvent } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/categorize'
import type { AgentRunHookEventItem } from '@/app/workspace/[workspaceUrl]/types'
import {
  PRUNED_PAYLOAD_KEY,
  buildPrunedPayload,
  buildUserDeletedPayload,
  isPrunedPayload,
  isUserDeletedPayload,
} from '@/lib/hook-event/retention'

function stubIntl(messages: Record<string, string>): IntlShape {
  return {
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => {
      const msg = messages[id]
      if (msg === undefined) throw new Error(`missing i18n key: ${id}`)
      return msg
    },
  } as unknown as IntlShape
}

const AT = new Date('2026-10-03T08:00:00Z')
const DELETED = buildUserDeletedPayload(AT, 'member_1')

function hookItem(payload: unknown): AgentRunHookEventItem {
  return {
    id: 'he_1',
    kind: 'hook',
    type: 'POST_TOOL_USE',
    toolName: 'Bash',
    payload,
    turnSummary: null,
    turnCost: null,
    createdAt: '2026-06-01T00:00:00Z',
  }
}

describe('user-deleted session record marker (LUM-944)', () => {
  it('buildUserDeletedPayload records when and by whom, and nothing else', () => {
    expect(DELETED).toEqual({
      [PRUNED_PAYLOAD_KEY]: {
        at: '2026-10-03T08:00:00.000Z',
        reason: 'USER_DELETED',
        by: 'member_1',
      },
    })
    expect(isPrunedPayload(DELETED)).toBe(true)
    expect(isUserDeletedPayload(DELETED)).toBe(true)
  })

  it('isUserDeletedPayload is false for sweep markers and whole payloads', () => {
    expect(isUserDeletedPayload(buildPrunedPayload(AT, 90))).toBe(false)
    expect(isUserDeletedPayload({ tool_name: 'Bash' })).toBe(false)
    expect(isUserDeletedPayload(null)).toBe(false)
  })

  it('session timeline marks a hand-deleted event as deleted, a swept one as not', () => {
    const raw = (id: string, payload: unknown): RawEvent => ({
      id,
      type: 'POST_TOOL_USE',
      toolName: 'Bash',
      payload,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    })
    const items = mergeEvents([
      raw('a', DELETED),
      raw('b', buildPrunedPayload(AT, 90)),
    ])
    expect(items.map(i => [i.key, i.pruned, i.deleted])).toEqual([
      ['a', true, true],
      ['b', true, false],
    ])
  })

  it('agent-run timeline says the raw content was deleted', () => {
    expect(summarizeEvent(hookItem(DELETED), stubIntl(en))).toBe(
      'Raw content deleted'
    )
    expect(summarizeEvent(hookItem(DELETED), stubIntl(zhCN))).toBe(
      '原文已被删除'
    )
    expect(
      summarizeEvent(hookItem(buildPrunedPayload(AT, 90)), stubIntl(en))
    ).toBe('Content cleared per retention policy')
  })
})
