/**
 * @jest-environment node
 *
 * LUM-1095 — notification blocks: header, linked entity title, actor,
 * carrier-specific mention labels, DM wording, quotes that keep paragraphs,
 * and a `text` fallback for every event.
 */
import {
  NOTIFICATION_QUOTE_LIMIT,
  VIEW_PR_LABEL,
  buildNotificationMessage,
  mentionPlace,
  quoteMrkdwn,
} from '@/lib/integrations/slack/notification-message'
import { OPEN_IN_LUMO_LABEL } from '@/lib/integrations/slack/blocks'
import {
  ALL_SLACK_EVENTS,
  type NotificationPayload,
  type SlackEventType,
} from '@/lib/integrations/slack/types'

type Block = {
  type: string
  text?: { type: string; text: string }
  elements?: Array<{ type: string; text?: unknown; url?: string }>
}

const TASK: NotificationPayload = {
  entityKind: 'task',
  entityId: 'task_1',
  entityTitle: 'Fix login',
  entityIdentifier: 'LUM-1',
  entityUrl: 'https://lumo.test/t/LUM-1',
  actorName: 'Ada',
}

function blocksOf(
  event: SlackEventType,
  payload: NotificationPayload,
  audience: 'channel' | 'dm'
) {
  const msg = buildNotificationMessage(event, payload, audience)
  return { msg, blocks: (msg.blocks ?? []) as Block[] }
}

function header(blocks: Block[]): string {
  const h = blocks.find(b => b.type === 'header')
  return h?.text?.text ?? ''
}

function sections(blocks: Block[]): string[] {
  return blocks.filter(b => b.type === 'section').map(b => b.text!.text)
}

function context(blocks: Block[]): string {
  const c = blocks.find(b => b.type === 'context')
  return (c?.elements ?? []).map(e => String(e.text)).join(' ')
}

function buttons(blocks: Block[]): Array<{ label: string; url: string }> {
  const a = blocks.find(b => b.type === 'actions')
  return (a?.elements ?? []).map(e => ({
    label: (e.text as { text: string }).text,
    url: e.url ?? '',
  }))
}

describe('buildNotificationMessage — every event', () => {
  it.each(ALL_SLACK_EVENTS)(
    '%s: header, linked title, actor, button and text fallback (channel + DM)',
    event => {
      for (const audience of ['channel', 'dm'] as const) {
        const { msg, blocks } = blocksOf(event, TASK, audience)
        expect(blocks[0]!.type).toBe('header')
        expect(header(blocks).trim()).not.toBe('')
        expect(sections(blocks)[0]).toBe(
          '*<https://lumo.test/t/LUM-1|LUM-1 · Fix login>*'
        )
        expect(buttons(blocks)[0]).toEqual({
          label: OPEN_IN_LUMO_LABEL,
          url: 'https://lumo.test/t/LUM-1',
        })
        expect(msg.text).toContain('LUM-1 · Fix login')
        if (event === 'comment_mention' && audience === 'dm') {
          // The actor is in the header ("Ada mentioned you…").
          expect(header(blocks)).toContain('Ada')
        } else {
          expect(msg.text).toContain('by Ada')
        }
        expect(context(blocks)).toContain('by *Ada*')
      }
    }
  )

  it('channel and DM headlines differ; DMs address the recipient', () => {
    const cases: Array<[SlackEventType, string, string]> = [
      ['task_assigned', 'Task assigned', 'You were assigned a task'],
      ['task_sent_back', 'Task sent back', 'Your task was sent back'],
      ['task_done', 'Task done', 'Your task was marked done'],
      [
        'task_in_review',
        'Task ready for review',
        'A task in your project is ready for review',
      ],
      ['task_created', 'Task created', 'A new task was created'],
      ['pr_opened', 'PR opened', 'A PR was opened in your project'],
      ['pr_merged', 'PR merged', 'A PR on your task was merged'],
    ]
    for (const [event, channel, dm] of cases) {
      expect(header(blocksOf(event, TASK, 'channel').blocks)).toContain(channel)
      expect(header(blocksOf(event, TASK, 'dm').blocks)).toContain(dm)
    }
  })

  it('PR events show the PR link and a View PR button', () => {
    const { msg, blocks } = blocksOf(
      'pr_merged',
      {
        ...TASK,
        actorName: 'octocat (GitHub)',
        prNumber: 7,
        prTitle: 'Add login',
        prUrl: 'https://github.com/acme/web/pull/7',
      },
      'channel'
    )
    expect(sections(blocks)[0]).toContain(
      '🔀 <https://github.com/acme/web/pull/7|#7 Add login>'
    )
    expect(buttons(blocks).map(b => b.label)).toEqual([
      OPEN_IN_LUMO_LABEL,
      VIEW_PR_LABEL,
    ])
    expect(context(blocks)).toContain('by *octocat (GitHub)*')
    expect(msg.text).toBe(
      '🎉 PR merged: LUM-1 · Fix login — by octocat (GitHub) — PR #7 Add login'
    )
  })

  it('omits actor and button when unknown, and never sends an empty text', () => {
    const { msg, blocks } = blocksOf(
      'task_created',
      { entityTitle: 'Bare' },
      'channel'
    )
    expect(blocks.some(b => b.type === 'context')).toBe(false)
    expect(blocks.some(b => b.type === 'actions')).toBe(false)
    expect(sections(blocks)[0]).toBe('*Bare*')
    expect(msg.text).toBe('🆕 Task created: Bare')
  })
})

describe('mentions — labelled by where they were written', () => {
  it('mentionPlace names the carrier', () => {
    expect(mentionPlace('task', 'comment')).toBe('a task comment')
    expect(mentionPlace('task', 'content')).toBe('a task description')
    expect(mentionPlace('document', 'comment')).toBe('a document comment')
    expect(mentionPlace('document', 'content')).toBe('a document')
    expect(mentionPlace('project', 'content')).toBe('a project description')
    expect(mentionPlace('milestone', 'content')).toBe('a milestone description')
  })

  const entities: Array<[string, NotificationPayload, string, string]> = [
    [
      'task comment',
      { ...TASK, mentionSurface: 'comment' },
      'Ada mentioned you in a task comment',
      '*<https://lumo.test/t/LUM-1|LUM-1 · Fix login>*',
    ],
    [
      'document',
      {
        entityKind: 'document',
        entityTitle: 'Spec',
        entityUrl: 'https://lumo.test/d/spec',
        actorName: 'Ada',
        mentionSurface: 'content',
      },
      'Ada mentioned you in a document',
      '📄 *<https://lumo.test/d/spec|Spec>*',
    ],
    [
      'project',
      {
        entityKind: 'project',
        entityTitle: 'Backend',
        entityUrl: 'https://lumo.test/p/backend',
        actorName: 'Ada',
        mentionSurface: 'content',
      },
      'Ada mentioned you in a project description',
      '📁 *<https://lumo.test/p/backend|Backend>*',
    ],
    [
      'milestone',
      {
        entityKind: 'milestone',
        entityTitle: 'v2 launch',
        entityUrl: 'https://lumo.test/m/v2',
        actorName: 'Ada',
        mentionSurface: 'content',
      },
      'Ada mentioned you in a milestone description',
      '🏁 *<https://lumo.test/m/v2|v2 launch>*',
    ],
  ]

  it.each(entities)(
    '%s mention DM names the entity and the carrier',
    (_n, payload, head, title) => {
      const { msg, blocks } = blocksOf(
        'comment_mention',
        { ...payload, quote: 'hi' },
        'dm'
      )
      expect(header(blocks)).toBe(`💬 ${head}`)
      expect(sections(blocks)[0]).toBe(title)
      expect(sections(blocks)[1]).toBe('> hi')
      expect(msg.text).toContain(head)
      expect(msg.text).not.toContain('Comment mention')
    }
  )

  it('DM without a known actor still says what happened', () => {
    const { blocks } = blocksOf(
      'comment_mention',
      { ...TASK, actorName: undefined, mentionSurface: 'content' },
      'dm'
    )
    expect(header(blocks)).toBe('💬 You were mentioned in a task description')
  })

  it('channel mention lists mentioned names as text, never <@…> pings', () => {
    const { msg, blocks } = blocksOf(
      'comment_mention',
      {
        ...TASK,
        mentionedNames: ['Bob', 'Carol <!here>'],
        mentionSurface: 'comment',
      },
      'channel'
    )
    expect(header(blocks)).toBe('💬 Mention in a task comment')
    expect(context(blocks)).toBe(
      'by *Ada* · mentioned *Bob*, *Carol &lt;!here&gt;*'
    )
    expect(JSON.stringify(msg)).not.toMatch(/<@|<!here>/)
  })
})

describe('quotes', () => {
  it('keeps paragraphs and quotes every line', () => {
    expect(quoteMrkdwn('First para\nsecond line\n\nNext para')).toBe(
      '> First para\n> second line\n>\n> Next para'
    )
  })

  it('cuts long text once, with an ellipsis', () => {
    const long = 'x'.repeat(NOTIFICATION_QUOTE_LIMIT + 50)
    const quoted = quoteMrkdwn(long)
    expect(quoted.endsWith('…')).toBe(true)
    expect(Array.from(quoted.slice(2))).toHaveLength(NOTIFICATION_QUOTE_LIMIT)
  })

  it('caps the number of lines, with an ellipsis', () => {
    const quoted = quoteMrkdwn(
      Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    )
    const lines = quoted.split('\n')
    expect(lines).toHaveLength(8)
    expect(lines[7]).toBe('> l7…')
  })

  it('escapes each quoted line', () => {
    expect(quoteMrkdwn('a <!channel>\nb & <https://x|y>')).toBe(
      '> a &lt;!channel&gt;\n> b &amp; &lt;https://x|y&gt;'
    )
  })

  it('a multi-paragraph quote reaches the message as one quoted section', () => {
    const { blocks } = blocksOf(
      'comment_mention',
      { ...TASK, quote: 'one\n\ntwo' },
      'dm'
    )
    expect(sections(blocks)[1]).toBe('> one\n>\n> two')
  })
})
