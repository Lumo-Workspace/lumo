/**
 * @jest-environment node
 */
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const now = new Date('2026-04-24T12:00:00Z')

const baseTask = {
  id: 'task_cmoc',
  identifier: 'LUM-30',
  title: 'Task-Run relation',
  status: 'IN_PROGRESS',
  description: 'Wire Session.taskId and build `lumo task context`.',
}

describe('formatTaskContextMarkdown', () => {
  it('renders the task header with description when present', () => {
    const md = formatTaskContextMarkdown({ task: baseTask, sessions: [] }, now)
    expect(md).toContain('# Task: LUM-30')
    expect(md).toContain('**Title**: Task-Run relation')
    expect(md).toContain('**Status**: IN_PROGRESS')
    expect(md).toContain('**Description**: Wire Session.taskId')
  })

  it('omits the Description line when description is null or empty', () => {
    const md = formatTaskContextMarkdown(
      { task: { ...baseTask, description: null }, sessions: [] },
      now
    )
    expect(md).not.toContain('**Description**:')
  })

  it('renders "No prior coding sessions" when sessions is empty', () => {
    const md = formatTaskContextMarkdown({ task: baseTask, sessions: [] }, now)
    expect(md).toContain('## Previous Sessions (0)')
    expect(md).toContain('_No prior coding sessions for this task._')
  })

  it('formats each session with id prefix, relative time, duration, and headline', () => {
    const md = formatTaskContextMarkdown(
      {
        task: baseTask,
        sessions: [
          {
            id: 'abc12345-deadbeef',
            startedAt: '2026-04-22T09:00:00Z',
            lastActivityAt: '2026-04-22T10:20:00Z',
            durationMs: 80 * 60 * 1000,
            eventCount: 42,
            summaryType: 'implementation',
            headline: 'Wire Session.taskId',
            unresolved: ['Schema design not finalized'],
          },
        ],
      },
      now
    )
    expect(md).toContain('## Previous Sessions (1)')
    expect(md).toContain('### Session abc12345 · 2 days ago · 1h 20min')
    expect(md).toContain('**Summary**: Wire Session.taskId')
    expect(md).toContain('**Unresolved**:')
    expect(md).toContain('- Schema design not finalized')
  })

  it('skips the Unresolved block when empty', () => {
    const md = formatTaskContextMarkdown(
      {
        task: baseTask,
        sessions: [
          {
            id: 'sess_11111111',
            startedAt: '2026-04-24T10:00:00Z',
            lastActivityAt: '2026-04-24T10:30:00Z',
            durationMs: 30 * 60 * 1000,
            eventCount: 10,
            summaryType: 'exploration',
            headline: 'Explored auth flow',
            unresolved: [],
          },
        ],
      },
      now
    )
    expect(md).not.toContain('**Unresolved**:')
  })

  it('uses hour+minute duration formatting for long sessions', () => {
    const md = formatTaskContextMarkdown(
      {
        task: baseTask,
        sessions: [
          {
            id: 'sess_11111111',
            startedAt: '2026-04-24T08:00:00Z',
            lastActivityAt: '2026-04-24T10:15:00Z',
            durationMs: (2 * 60 + 15) * 60 * 1000,
            eventCount: 1,
            summaryType: null,
            headline: 'x',
            unresolved: [],
          },
        ],
      },
      now
    )
    expect(md).toContain('· 2h 15min')
  })

  it('inlines memorySection between header and sessions when present', () => {
    const md = formatTaskContextMarkdown(
      {
        task: baseTask,
        memorySection:
          '## Relevant Memory\n\n### Traps\n\n- [task] **x** → y\n\n',
        sessions: [],
      },
      now
    )
    const memIdx = md.indexOf('## Relevant Memory')
    const sessIdx = md.indexOf('## Previous Sessions')
    expect(memIdx).toBeGreaterThan(0)
    expect(memIdx).toBeLessThan(sessIdx)
    expect(md).toContain('- [task] **x** → y')
  })

  it('omits memory section when memorySection is empty or missing', () => {
    const mdEmpty = formatTaskContextMarkdown(
      { task: baseTask, memorySection: '', sessions: [] },
      now
    )
    const mdMissing = formatTaskContextMarkdown(
      { task: baseTask, sessions: [] },
      now
    )
    expect(mdEmpty).not.toContain('## Relevant Memory')
    expect(mdMissing).not.toContain('## Relevant Memory')
  })

  it('renders prReviewTodosSection (after PRs, before sessions) when present', () => {
    const md = formatTaskContextMarkdown(
      {
        task: baseTask,
        prSection: '## Pull Requests\n\n- #7 Do the thing — open · passing',
        prReviewTodosSection:
          '## PR Review 待办\n\n- [ ] `lib/foo.ts:42` (@octocat) — Extract this\n  ↳ https://gh/c/1',
        sessions: [],
      },
      now
    )
    const prIdx = md.indexOf('## Pull Requests')
    const todoIdx = md.indexOf('## PR Review 待办')
    const sessIdx = md.indexOf('## Previous Sessions')
    expect(prIdx).toBeGreaterThan(0)
    expect(prIdx).toBeLessThan(todoIdx)
    expect(todoIdx).toBeLessThan(sessIdx)
    expect(md).toContain('- [ ] `lib/foo.ts:42` (@octocat) — Extract this')
  })

  it('omits the PR Review 待办 section when empty or missing', () => {
    const mdEmpty = formatTaskContextMarkdown(
      { task: baseTask, prReviewTodosSection: '', sessions: [] },
      now
    )
    const mdMissing = formatTaskContextMarkdown(
      { task: baseTask, sessions: [] },
      now
    )
    expect(mdEmpty).not.toContain('## PR Review 待办')
    expect(mdMissing).not.toContain('## PR Review 待办')
  })

  it('renders "just now" / "Xmin ago" / "yesterday" per relative-time rules', () => {
    const mk = (offsetSec: number) => ({
      id: 'x12345678',
      startedAt: new Date(
        now.getTime() - offsetSec * 1000 - 60_000
      ).toISOString(),
      lastActivityAt: new Date(now.getTime() - offsetSec * 1000).toISOString(),
      durationMs: 60_000,
      eventCount: 1,
      summaryType: null,
      headline: 'h',
      unresolved: [],
    })
    expect(
      formatTaskContextMarkdown({ task: baseTask, sessions: [mk(10)] }, now)
    ).toContain('· just now ·')
    expect(
      formatTaskContextMarkdown({ task: baseTask, sessions: [mk(180)] }, now)
    ).toContain('· 3min ago ·')
    expect(
      formatTaskContextMarkdown(
        { task: baseTask, sessions: [mk(24 * 3600 + 100)] },
        now
      )
    ).toContain('· yesterday ·')
  })
})

describe('formatTaskContextMarkdown — descriptionMarkdown', () => {
  it('prefers descriptionMarkdown over description', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: '<p>html</p>',
          descriptionMarkdown: '## md',
        },
        sessions: [],
      } as any,
      new Date('2026-05-28T00:00:00Z')
    )
    expect(out).toContain('## md')
    expect(out).not.toContain('<p>html</p>')
  })

  it('falls back to description when descriptionMarkdown missing', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: 'plain body',
        },
        sessions: [],
      } as any,
      new Date('2026-05-28T00:00:00Z')
    )
    expect(out).toContain('plain body')
  })

  it('falls back to description when descriptionMarkdown is explicitly null', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: 'fallback body',
          descriptionMarkdown: null,
        },
        sessions: [],
      } as any,
      new Date('2026-05-28T00:00:00Z')
    )
    expect(out).toContain('fallback body')
  })
})
