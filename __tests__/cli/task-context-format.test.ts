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
    // LUM-998: the description prints inside its own fence.
    expect(md).toContain(
      '<untrusted-task-description>\nNOTE TO ASSISTANT: the task description'
    )
    expect(md).toContain(
      '\n\nWire Session.taskId and build `lumo task context`.\n</untrusted-task-description>'
    )
    expect(md).not.toContain('**Description**:')
  })

  it('omits the description block when description is null or empty', () => {
    const md = formatTaskContextMarkdown(
      { task: { ...baseTask, description: null }, sessions: [] },
      now
    )
    expect(md).not.toContain('untrusted-task-description')
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
    // LUM-1232: absolute time (UTC `Z` off a TTY), never `2 days ago`.
    expect(md).toMatch(
      /### Session abc12345 · \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ · 1h 20m/
    )
    expect(md).toContain('**Summary**: Wire Session.taskId')
    // LUM-1067: open items are candidate follow-ups, not "Unresolved"
    expect(md).not.toContain('**Unresolved**:')
    expect(md).toContain('**Candidate follow-ups**')
    expect(md).toContain('- Schema design not finalized')
  })

  it('skips the follow-ups block when empty', () => {
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
    expect(md).not.toContain('**Candidate follow-ups**')
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
    expect(md).toContain('· 2h 15m')
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
          '## PR review todos\n\n- [ ] `lib/foo.ts:42` (@octocat) — Extract this\n  ↳ https://gh/c/1',
        sessions: [],
      },
      now
    )
    const prIdx = md.indexOf('## Pull Requests')
    const todoIdx = md.indexOf('## PR review todos')
    const sessIdx = md.indexOf('## Previous Sessions')
    expect(prIdx).toBeGreaterThan(0)
    expect(prIdx).toBeLessThan(todoIdx)
    expect(todoIdx).toBeLessThan(sessIdx)
    expect(md).toContain('- [ ] `lib/foo.ts:42` (@octocat) — Extract this')
  })

  it('omits the PR review todos section when empty or missing', () => {
    const mdEmpty = formatTaskContextMarkdown(
      { task: baseTask, prReviewTodosSection: '', sessions: [] },
      now
    )
    const mdMissing = formatTaskContextMarkdown(
      { task: baseTask, sessions: [] },
      now
    )
    expect(mdEmpty).not.toContain('## PR review todos')
    expect(mdMissing).not.toContain('## PR review todos')
  })

  it('prints the absolute last-activity time, never a relative one (LUM-1232)', () => {
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
    for (const offset of [10, 180, 24 * 3600 + 100]) {
      const md = formatTaskContextMarkdown(
        { task: baseTask, sessions: [mk(offset)] },
        now
      )
      const at = new Date(now.getTime() - offset * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
      expect(md).toContain(`### Session x1234567 · ${at} · 1m`)
      expect(md).not.toMatch(/just now|ago|yesterday/)
    }
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

describe('formatTaskContextMarkdown — milestone', () => {
  const milestoneBase = {
    id: 'ms_1',
    name: 'Milestone 功能增强',
    state: 'active' as const,
    targetDate: '2026-08-31T00:00:00.000Z',
  }

  it('renders the Milestone header line with state and target date', () => {
    const md = formatTaskContextMarkdown(
      { task: { ...baseTask, milestone: milestoneBase }, sessions: [] } as any,
      now
    )
    expect(md).toContain(
      '**Milestone**: Milestone 功能增强 (active, target 2026-08-31)'
    )
  })

  it('renders the Milestone goal line when description is present', () => {
    const md = formatTaskContextMarkdown(
      {
        task: {
          ...baseTask,
          milestone: {
            ...milestoneBase,
            description: 'Ship the milestone enhancements end to end.',
          },
        },
        sessions: [],
      } as any,
      now
    )
    expect(md).toContain(
      '**Milestone goal**: Ship the milestone enhancements end to end.'
    )
  })

  it('omits the Milestone goal line when description is null, empty, or whitespace', () => {
    for (const description of [null, '', '   ']) {
      const md = formatTaskContextMarkdown(
        {
          task: { ...baseTask, milestone: { ...milestoneBase, description } },
          sessions: [],
        } as any,
        now
      )
      expect(md).toContain('**Milestone**: Milestone 功能增强')
      expect(md).not.toContain('**Milestone goal**:')
    }
  })
})

describe('formatTaskContextMarkdown — lineageSection', () => {
  const LINEAGE_NOW = new Date('2026-06-06T00:00:00Z')

  it('appends lineageSection at the very end when sessions is empty', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: null,
        },
        sessions: [],
        lineageSection:
          '## Memory usefulness · judged-used track record\n\n- [MEMORY] "x" — judged-used in 3 of 4 tasks · proven',
      } as any,
      LINEAGE_NOW,
      { full: true }
    )
    expect(out).toContain('## Previous Sessions (0)')
    expect(out.indexOf('judged-used track record')).toBeGreaterThan(
      out.indexOf('Previous Sessions')
    )
    expect(out).toContain('judged-used in 3 of 4 tasks · proven')
  })

  it('appends lineageSection after a non-empty sessions block', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: null,
        },
        sessions: [
          {
            id: 'abcdef1234',
            startedAt: '2026-06-05T00:00:00Z',
            lastActivityAt: '2026-06-05T01:00:00Z',
            durationMs: 3600000,
            eventCount: 1,
            summaryType: null,
            headline: 'did things',
            unresolved: [],
          },
        ],
        lineageSection:
          '## Memory usefulness · judged-used track record\n\n- [PR] #1 — judged-used in 3 of 4 tasks',
      } as any,
      LINEAGE_NOW,
      { full: true }
    )
    expect(out.indexOf('judged-used track record')).toBeGreaterThan(
      out.indexOf('Previous Sessions (1)')
    )
  })

  // LUM-844: by default the audit table collapses to one pointer line.
  it('collapses lineageSection to a --full pointer by default', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: null,
        },
        sessions: [],
        lineageSection:
          '## Memory usefulness · judged-used track record\n\n- [MEMORY] "x" — judged-used in 3 of 4 tasks · proven',
      } as any,
      LINEAGE_NOW
    )
    expect(out).not.toContain('judged-used in 3 of 4 tasks')
    expect(out).toContain('lumo task show LUM-1 --full --memory')
  })

  it('omits the lineage block when lineageSection is absent/empty', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'T',
          status: 'TODO',
          description: null,
        },
        sessions: [],
        lineageSection: '',
      } as any,
      LINEAGE_NOW,
      { full: true }
    )
    expect(out).not.toContain('judged-used track record')
  })
})
