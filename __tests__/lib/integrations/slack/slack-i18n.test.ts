/**
 * @jest-environment node
 *
 * LUM-1097 — Slack notifications and command replies are written in the
 * locale they are built for. Every notification event (channel + DM) and
 * every command reply is checked in zh-CN and in en; the LUM-928 escaping
 * holds in both.
 */
import zh from '@/lib/i18n/zh-CN.json'
import en from '@/lib/i18n/en.json'
import { slackMrkdwn, slackText } from '@/lib/integrations/slack/i18n'
import {
  openInLumoLabel,
  priorityLabel,
  slackMessage,
  statusLabel,
} from '@/lib/integrations/slack/blocks'
import {
  buildNotificationMessage,
  mentionPlace,
} from '@/lib/integrations/slack/notification-message'
import {
  assignedReply,
  createdReply,
  helpReply,
  myTasksReply,
  statusChangedReply,
  statusReply,
} from '@/lib/integrations/slack/commands'
import type {
  NotificationAudience,
  SlackEventType,
} from '@/lib/integrations/slack/types'
import type { SlackTaskDetail } from '@/lib/services/slack-command.service'

const ZH = zh as Record<string, string>
const EN = en as Record<string, string>

type Block = {
  type: string
  text?: { text: string }
  elements?: Array<{ text: string | { text: string } }>
  accessory?: { text: { text: string } }
}

function header(blocks: object[] | undefined): string {
  const h = (blocks as Block[]).find(b => b.type === 'header')
  return h?.text?.text ?? ''
}
function buttons(blocks: object[] | undefined): string[] {
  return (blocks as Block[])
    .filter(b => b.type === 'actions')
    .flatMap(b => b.elements ?? [])
    .map(e => (typeof e.text === 'string' ? e.text : e.text.text))
}
function contextText(blocks: object[] | undefined): string {
  return (blocks as Block[])
    .filter(b => b.type === 'context')
    .flatMap(b => b.elements ?? [])
    .map(e => (typeof e.text === 'string' ? e.text : e.text.text))
    .join('\n')
}

describe('slackMrkdwn', () => {
  it('escapes the catalogue text but keeps caller-escaped values', () => {
    // `/lumo <command>` stays literal (escaped) in the help hint.
    const hint = slackMrkdwn('en', 'msg.cmd.help.hint', {
      slash: '`/lumo &lt;command&gt;`',
      mention: '`@Lumo &lt;command&gt;`',
    })
    expect(hint).toBe(
      'Type `/lumo &lt;command&gt;`, or mention `@Lumo &lt;command&gt;` in a channel.'
    )
    expect(slackMrkdwn('en', 'msg.by', { actor: '*A&amp;B*' })).toBe(
      'by *A&amp;B*'
    )
  })

  it('reads the zh-CN catalogue', () => {
    expect(slackText('zh-CN', 'msg.openInLumo')).toBe(
      ZH['slack.msg.openInLumo']
    )
    expect(openInLumoLabel('zh-CN')).toBe('在 Lumo 中打开 ↗')
  })
})

describe('status / priority labels', () => {
  it.each([
    ['en', '✅ Done', '🔴 Urgent'],
    ['zh-CN', '✅ 已完成', '🔴 紧急'],
  ] as const)('%s', (locale, done, urgent) => {
    expect(statusLabel('DONE', locale)).toBe(done)
    expect(priorityLabel('URGENT', locale)).toBe(urgent)
  })

  it('unknown values stay escaped in any locale', () => {
    expect(statusLabel('<!here>', 'zh-CN')).toBe('&lt;!here&gt;')
  })

  it('the empty-fallback line follows the locale', () => {
    expect(slackMessage({ text: '', locale: 'zh-CN' }).text).toBe(
      '来自 Lumo 的新消息'
    )
  })
})

// ── Notifications ──────────────────────────────────────────────────────────

const EVENTS: Array<Exclude<SlackEventType, 'comment_mention'>> = [
  'task_created',
  'task_assigned',
  'task_in_review',
  'task_done',
  'task_sent_back',
  'pr_opened',
  'pr_merged',
]
const AUDIENCES: NotificationAudience[] = ['channel', 'dm']

const payload = {
  entityTitle: 'Fix login',
  entityIdentifier: 'LUM-1',
  entityUrl: 'https://lumo.test/t/LUM-1',
  actorName: 'Ada',
  prNumber: 7,
  prTitle: 'Fix',
  prUrl: 'https://github.com/acme/web/pull/7',
}

describe.each([
  ['en', EN],
  ['zh-CN', ZH],
] as const)('notifications in %s', (locale, catalogue) => {
  for (const event of EVENTS) {
    for (const audience of AUDIENCES) {
      it(`${event} · ${audience}`, () => {
        const msg = buildNotificationMessage(event, payload, audience, locale)
        const headline = catalogue[`slack.msg.${audience}.${event}`]!
        expect(header(msg.blocks)).toContain(headline)
        expect(msg.text).toContain(headline)
        expect(buttons(msg.blocks)).toEqual([
          catalogue['slack.msg.openInLumo'],
          catalogue['slack.msg.viewPr'],
        ])
        const by = catalogue['slack.msg.by']!.replace('{actor}', '*Ada*')
        expect(contextText(msg.blocks)).toBe(by)
      })
    }
  }

  it('comment mention · channel names the place and who was mentioned', () => {
    const msg = buildNotificationMessage(
      'comment_mention',
      {
        ...payload,
        entityKind: 'document',
        mentionSurface: 'comment',
        mentionedNames: ['Bob'],
      },
      'channel',
      locale
    )
    const place = catalogue['slack.msg.place.comment.document']!
    expect(header(msg.blocks)).toContain(
      catalogue['slack.msg.mention.channel']!.replace('{place}', place)
    )
    expect(contextText(msg.blocks)).toContain(
      catalogue['slack.msg.mentioned']!.replace('{names}', '*Bob*')
    )
  })

  it('comment mention · DM speaks to the recipient', () => {
    const msg = buildNotificationMessage(
      'comment_mention',
      { ...payload, entityKind: 'project', mentionSurface: 'content' },
      'dm',
      locale
    )
    const place = mentionPlace('project', 'content', locale)
    expect(place).toBe(catalogue['slack.msg.place.content.project'])
    expect(header(msg.blocks)).toContain(
      catalogue['slack.msg.mention.dmByActor']!.replace(
        '{actor}',
        'Ada'
      ).replace('{place}', place)
    )
  })
})

it('a translated message still escapes injected values (LUM-928)', () => {
  const msg = buildNotificationMessage(
    'task_assigned',
    { ...payload, actorName: '<!channel>', entityTitle: '<@U1>' },
    'channel',
    'zh-CN'
  )
  const json = JSON.stringify(msg)
  expect(json).not.toContain('<!channel>')
  expect(json).not.toContain('<@U1>')
  expect(msg.text).toContain('&lt;!channel&gt;')
})

// ── Command replies ────────────────────────────────────────────────────────

const task: SlackTaskDetail = {
  id: 't1',
  identifier: 'ENG-1',
  number: 1,
  title: 'Fix <bug>',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  projectId: 'p1',
  projectName: 'Web',
  teamIdentifier: 'ENG',
  workspaceSlug: 'acme',
  assigneeName: null,
}

function allText(r: ReturnType<typeof helpReply>): string {
  return JSON.stringify(r)
}

describe.each([
  ['en', EN],
  ['zh-CN', ZH],
] as const)('command replies in %s', (locale, catalogue) => {
  const t = (key: string) => catalogue[`slack.msg.${key}`]!

  it('help', () => {
    const r = helpReply(locale)
    expect(r.type === 'blocks' && header(r.blocks)).toBe(t('cmd.help.title'))
    expect(allText(r)).toContain(t('cmd.help.myTasks'))
    // Command words stay English — the parser reads them.
    expect(allText(r)).toContain('`my-tasks`')
    expect(allText(r)).toContain('&lt;command&gt;')
  })

  it('status', () => {
    const r = statusReply(task, locale)
    const json = allText(r)
    expect(json).toContain(t('cmd.unassigned'))
    expect(json).toContain(t('status.IN_PROGRESS'))
    expect(json).toContain(t('priority.HIGH'))
    expect(json).toContain(t('cmd.projectField').replace('{project}', 'Web'))
    expect(json).toContain(t('openInLumo'))
    expect(json).toContain('Fix &lt;bug&gt;')
  })

  it('status changed', () => {
    const r = statusChangedReply(task, 'DONE', locale)
    expect(r.text).toBe(
      t('cmd.moved')
        .replace('{task}', 'ENG-1 · Fix &lt;bug&gt;')
        .replace('{status}', `✅ ${t('status.DONE')}`)
    )
  })

  it('assigned', () => {
    const r = assignedReply(task, 'Ada', locale)
    expect(r.text).toBe(
      t('cmd.assigned')
        .replace('{task}', 'ENG-1 · Fix &lt;bug&gt;')
        .replace('{name}', 'Ada')
    )
  })

  it('created', () => {
    const r = createdReply(task, locale)
    expect(r.text).toBe(
      `✅ ${t('cmd.created').replace('{task}', 'ENG-1 · Fix &lt;bug&gt;')}`
    )
  })

  it('my-tasks (some, all, none)', () => {
    const some = myTasksReply([task], 3, locale)
    expect(allText(some)).toContain(
      t('cmd.showingOf').replace('{shown}', '1').replace('{total}', '3')
    )
    expect(allText(some)).toContain(t('viewAllInLumo'))
    const all = myTasksReply([task], 1, locale)
    expect(allText(all)).toContain(
      t('cmd.openTaskCount').replace('{total}', '1')
    )
    expect(myTasksReply([], 0, locale)).toEqual({
      type: 'text',
      text: t('cmd.noOpenTasks'),
      visibility: 'ephemeral',
    })
  })
})
