/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch G — internal ids out of human output (G1–G3) and
 * `--no-hints` covering `next` and `task runs` (G4, G5). The paging footer is
 * data and is not affected (Q5).
 */
import {
  formatAuditList,
  type AuditListPage,
} from '../../cli/src/commands/audit-list'
import {
  formatCommentThread,
  type CommentNode,
} from '../../cli/src/commands/task-comment-list'
import {
  notificationSentence,
  type InboxNotification,
} from '../../cli/src/commands/inbox-list'
import { formatNextOutput } from '../../cli/src/commands/next'
import {
  formatRunReport,
  type RunReport,
} from '../../cli/src/commands/task-runs'
import type { RankedTask } from '../../cli/src/lib/rank-tasks'
import { buildAgentRunReport } from '@/lib/services/agent-run-report.service'
import { TIMELINE } from '../helpers/lum1188-agent-runs-timeline'

describe('G1 — audit list prints the crossing ref, not the cuid', () => {
  const page = {
    events: [
      {
        id: 'ev_1',
        createdAt: '2026-10-17T07:07:37.000Z',
        action: 'boundary_crossing.dispositioned',
        actorType: 'MEMBER',
        actorId: 'u_1',
        actorName: 'Chao Li',
        actorEmail: null,
        source: 'CLI',
        targetType: 'boundary_crossing',
        targetId: 'cmvc1w4f7000u08larvqrob83',
        targetRef: 'LUM-X928',
        ip: null,
      },
      {
        id: 'ev_2',
        createdAt: '2026-10-17T07:00:00.000Z',
        action: 'member.role_changed',
        actorType: 'MEMBER',
        actorId: 'u_1',
        actorName: 'Chao Li',
        actorEmail: null,
        source: 'WEB',
        targetType: 'member',
        targetId: 'm_2',
        ip: null,
      },
    ],
    nextCursor: null,
  } as AuditListPage

  it('uses targetRef when present, the id otherwise (older server)', () => {
    const out = formatAuditList(page, {}, { tty: false, color: false })
    expect(out).toContain('boundary_crossing LUM-X928')
    expect(out).not.toContain('cmvc1w4f7000u08larvqrob83')
    expect(out).toContain('member m_2')
  })
})

describe('G2 — comment authors by name, never the actor id', () => {
  const comments: CommentNode[] = [
    {
      id: 'cmusgk4w0000abcd',
      authorActorId: '7129f67e-232f-4171-b02b-f5bece6ec12e',
      body: 'hello',
      createdAt: '2026-10-03T15:59:00.000Z',
      replies: [
        {
          id: 'cmusgk4w0001abcd',
          authorActorId: 'actor_unknown',
          body: 'reply',
          createdAt: '2026-10-03T16:00:00.000Z',
        },
      ],
    },
  ]
  const names = new Map([['7129f67e-232f-4171-b02b-f5bece6ec12e', 'Chao Li']])

  it('a known author prints by name; an unknown one prints -', () => {
    const out = formatCommentThread(comments, { full: true, actorNames: names })
    expect(out).toMatch(/ · Chao Li · /)
    expect(out).toMatch(/ · - · /)
    expect(out).not.toContain('7129f67e')
    expect(out).not.toContain('actor_unknown')
  })
})

describe('G2 — the server-sent authorName wins', () => {
  it('prints authorName (e.g. a GitHub reviewer) even without a directory entry', () => {
    const out = formatCommentThread(
      [
        {
          id: 'cmvciq5o0000abcd',
          authorActorId: 'cmv03cz6h00s106l2rn8rqzei',
          authorName: '@uselumo[bot]',
          body: 'scan summary',
          createdAt: '2026-10-17T14:55:10.000Z',
        },
      ],
      { full: true, actorNames: new Map() }
    )
    expect(out).toMatch(/ · @uselumo\[bot\] · /)
    expect(out).not.toContain('cmv03cz6h00s106l2rn8rqzei')
  })
})

describe('G3 — inbox names a deleted task instead of "a task"', () => {
  const base = {
    id: 'n1',
    type: 'TASK_IN_REVIEW',
    read: true,
    requiresAction: false,
    actionTakenAt: null,
    createdAt: '2026-06-10T06:19:53.121Z',
    actor: { name: 'Vincent Mou' },
    task: null,
    sprint: null,
    project: null,
    milestone: null,
    document: null,
    commentPreview: null,
  } as unknown as InboxNotification

  it('a taskId whose task is gone reads "a deleted task"', () => {
    expect(notificationSentence({ ...base, taskId: 'cmq7oiln0001' })).toBe(
      'Vincent Mou submitted for review a deleted task'
    )
  })

  it('no task at all keeps the generic wording', () => {
    expect(notificationSentence(base)).toBe(
      'Vincent Mou submitted for review a task'
    )
  })
})

describe('G4 — next: --no-hints drops the Next block and the hint', () => {
  const ranked = [
    {
      identifier: 'LUM-1039',
      task: { status: 'TODO', priority: 'URGENT', title: 'Fix MCP routing' },
      reasons: ['URGENT'],
    },
    {
      identifier: 'LUM-1075',
      task: { status: 'TODO', priority: 'HIGH', title: 'Cut over' },
      reasons: ['HIGH', 'unblocks 2 tasks'],
    },
  ] as unknown as RankedTask[]

  it('hints on: Next block plus one Hint line (no bare aside)', () => {
    const out = formatNextOutput(ranked, 66, 'open', {
      tty: false,
      hints: true,
    })
    expect(out).toContain('Next:\n  lumo session attach LUM-1039')
    expect(out).toContain(
      'Hint: any other task in the list works the same way.'
    )
    expect(out).not.toContain('(or pick any other task from the list)')
  })

  it('hints off: the ranked list only', () => {
    const out = formatNextOutput(ranked, 66, 'open', {
      tty: false,
      hints: false,
    })
    expect(out).toContain('LUM-1039')
    expect(out).not.toContain('Next:')
    expect(out).not.toContain('Hint:')
    expect(out).not.toMatch(/\n$/)
  })

  it('LUMO_NO_HINTS=1 is the default switch', () => {
    const prev = process.env.LUMO_NO_HINTS
    process.env.LUMO_NO_HINTS = '1'
    try {
      expect(
        formatNextOutput(ranked, 66, 'open', { tty: false })
      ).not.toContain('Next:')
    } finally {
      if (prev === undefined) delete process.env.LUMO_NO_HINTS
      else process.env.LUMO_NO_HINTS = prev
    }
  })
})

describe('G5 — task runs: the trailing hint is a Hint line and obeys --no-hints', () => {
  const report = buildAgentRunReport(TIMELINE, {
    sessionCount: 1,
    forecast: null,
    tokenCost: { forecast: null, actual: 1_000, deltaPct: null, band: null },
    iterations: { forecast: null, actual: 1, deltaPct: null, band: null },
    interactionRounds: {
      forecast: null,
      actual: 1,
      deltaPct: null,
      band: null,
    },
    totalDuration: { forecast: null, actual: null, deltaPct: null, band: null },
  } as never) as unknown as RunReport

  it('hints on: `Hint:` replaces `More:`', () => {
    const out = formatRunReport('LUM-1185', report, { hints: true })
    expect(out).toContain('Hint: `--full` adds attribution signals')
    expect(out).not.toContain('More:')
  })

  it('hints off: no trailing hint at all', () => {
    const out = formatRunReport('LUM-1185', report, { hints: false })
    expect(out).not.toContain('Hint:')
    expect(out).not.toContain('More:')
  })
})
