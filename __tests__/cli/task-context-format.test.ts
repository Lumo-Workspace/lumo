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
