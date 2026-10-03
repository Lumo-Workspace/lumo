import type { IntlShape } from 'react-intl'
import en from '@/lib/i18n/en.json'
import zhCN from '@/lib/i18n/zh-CN.json'
import { mergeEvents, type RawEvent } from '@/app/sessions/[id]/merge-events'
import { summarizeEvent } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/categorize'
import type { AgentRunHookEventItem } from '@/app/workspace/[workspaceUrl]/types'
import { buildPrunedPayload, isPrunedPayload } from '@/lib/hook-event/retention'

// react-intl ships ESM jest can't load — a minimal formatMessage stand-in
// over the real locale files (same approach as format-duration.test.ts).
function stubIntl(locale: string, messages: Record<string, string>): IntlShape {
  return {
    locale,
    formatMessage: ({ id }: { id: string }) => {
      const msg = messages[id]
      if (msg === undefined) throw new Error(`missing i18n key: ${id}`)
      return msg
    },
  } as unknown as IntlShape
}

const PRUNED = buildPrunedPayload(new Date('2026-09-01T00:00:00Z'), 90)

function raw(
  id: string,
  type: RawEvent['type'],
  toolName: string | null,
  at: string
): RawEvent {
  return { id, type, toolName, payload: PRUNED, createdAt: new Date(at) }
}

function hookItem(
  type: AgentRunHookEventItem['type'],
  toolName: string | null
): AgentRunHookEventItem {
  return {
    id: 'he_1',
    kind: 'hook',
    type,
    toolName,
    payload: PRUNED,
    turnSummary: null,
    turnCost: null,
    createdAt: '2026-06-01T00:00:00Z',
  }
}

describe('pruned hook events (LUM-859)', () => {
  it('renders a pruned event as cleared by retention policy', () => {
    // Session page: one row per cleared tool call (Pre skipped, Post kept),
    // prompt and stop rows keep their kind, nothing throws.
    const items = mergeEvents([
      raw('p1', 'USER_PROMPT_SUBMIT', null, '2026-06-01T00:00:00Z'),
      raw('a', 'PRE_TOOL_USE', 'Bash', '2026-06-01T00:00:01Z'),
      raw('b', 'POST_TOOL_USE', 'Bash', '2026-06-01T00:00:02Z'),
      raw('s1', 'STOP', null, '2026-06-01T00:00:03Z'),
    ])
    expect(items.map(i => [i.kind, i.toolName, i.pruned, i.status])).toEqual([
      ['user-prompt', null, true, 'ok'],
      ['tool', 'Bash', true, 'ok'],
      ['stop', null, true, 'ok'],
    ])
    expect(items.every(i => i.details.length === 0)).toBe(true)

    // Agent-run timeline: the localized notice for every event type.
    const intlEn = stubIntl('en', en)
    const intlZh = stubIntl('zh-CN', zhCN)
    for (const [type, tool] of [
      ['POST_TOOL_USE', 'Edit'],
      ['USER_PROMPT_SUBMIT', null],
      ['STOP', null],
    ] as const) {
      expect(summarizeEvent(hookItem(type, tool), intlEn)).toBe(
        'Content cleared per retention policy'
      )
      expect(summarizeEvent(hookItem(type, tool), intlZh)).toBe(
        '内容已按保留策略清除'
      )
    }
  })

  it('does not treat an ordinary payload as pruned', () => {
    expect(isPrunedPayload({ tool_name: 'Bash' })).toBe(false)
    expect(isPrunedPayload(null)).toBe(false)
    expect(isPrunedPayload([PRUNED])).toBe(false)
    expect(isPrunedPayload(PRUNED)).toBe(true)
  })
})
