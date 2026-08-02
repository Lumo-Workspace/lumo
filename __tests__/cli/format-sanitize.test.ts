/**
 * @jest-environment node
 */
import { formatTaskListTable } from '@/cli/src/lib/format'
import { formatSprintUpdateSummary } from '@/cli/src/commands/sprint-update'
import { formatMilestoneUpdateSummary } from '@/cli/src/commands/milestone-update'
import { formatSprintSummary } from '@/cli/src/commands/sprint-summary'
import { formatMemoryList } from '@/cli/src/lib/memory-content'
import { formatProjectList } from '@/cli/src/commands/project-list'
import { formatShareListRows } from '@/cli/src/commands/doc-share-list'
import { formatSprintList } from '@/cli/src/commands/sprint-list'
import { formatMilestoneList } from '@/cli/src/commands/milestone-list'
import { formatTaskShow } from '@/cli/src/commands/task-show'
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'
import { formatSprintShow } from '@/cli/src/commands/sprint-show'
import { formatMilestoneShow } from '@/cli/src/commands/milestone-show'
import { formatShowOutput } from '@/cli/src/commands/doc-show'

describe('format helpers strip control chars', () => {
  it('formatTaskListTable strips ESC from title and project name', () => {
    const out = formatTaskListTable([
      {
        id: 't1',
        number: 1,
        title: 'Fix\x1b[31m bug',
        status: 'TODO',
        priority: 'LOW',
        teamIdentifier: 'LUM',
        project: { id: 'p1', name: 'we\x1bb' },
      },
    ])
    expect(out).not.toMatch(/\x1b/)
    expect(out).toContain('Fix[31m bug')
    expect(out).toContain('web')
  })

  it('formatSprintUpdateSummary strips ESC from sprint names', () => {
    const out = formatSprintUpdateSummary(
      { number: 3, name: 'old\x1bname' },
      { name: 'new\x1bname' }
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatMilestoneUpdateSummary strips ESC from milestone names', () => {
    const out = formatMilestoneUpdateSummary(
      { name: 'v1\x1b.0' },
      { name: 'v2\x1b.0' }
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatSprintSummary strips ESC from name, tldr, and report', () => {
    const out = formatSprintSummary({
      number: 3,
      name: 'sp\x1brint',
      stats: { done: 1, total: 2 },
      tldr: 'tl\x1bdr',
      report: 're\x1bport',
    })
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatMemoryList strips ESC from each category headline', () => {
    const out = formatMemoryList([
      {
        id: 'm1',
        scope: 'PROJECT',
        category: 'TRAP',
        content: { trigger: 'do\x1b[31m X', outcome: 'bad' },
        createdByMemberId: null,
      },
      {
        id: 'm2',
        scope: 'TEAM',
        category: 'DECISION',
        content: { what: 'pick\x1bA', why: 'because' },
        createdByMemberId: 'mem1',
      },
    ])
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatProjectList strips ESC from display name', () => {
    const out = formatProjectList([{ id: 'p1', name: 'My\x1b[31m Proj' }])
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatShareListRows strips ESC from display name', () => {
    const out = formatShareListRows([
      { displayName: 'Al\x1bice', role: 'EDITOR' },
    ]).join('\n')
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatSprintList strips ESC from name', () => {
    const out = formatSprintList([
      {
        id: 's1',
        number: 1,
        name: 'sp\x1brint',
        status: 'ACTIVE',
        startDate: null,
        endDate: null,
      },
    ])
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatMilestoneList strips ESC from name', () => {
    const out = formatMilestoneList([
      {
        id: 'm1',
        name: 'v1\x1b.0',
        completedAt: null,
        targetDate: null,
        createdAt: '2026-01-01',
        archivedAt: null,
      },
    ])
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatTaskShow strips ESC from title, project, assignee, description', () => {
    const out = formatTaskShow({
      id: 't1',
      identifier: 'LUM-1',
      title: 'Fix\x1b[31m bug',
      status: 'TODO',
      priority: 'LOW',
      description: 'desc\x1bription',
      url: 'https://lumo.so/t/1',
      project: { id: 'p1', name: 'pro\x1bj' },
      assignee: { type: 'member', label: 'Al\x1bice', email: 'a@b.com' },
    })
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatTaskContextMarkdown strips ESC from title, milestone, description, memorySection', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 'Ti\x1btle',
          status: 'TODO',
          description: 'de\x1bsc',
          milestone: {
            id: 'm1',
            name: 'v\x1b1',
            state: 'active' as const,
            targetDate: null,
          },
        },
        memorySection: '## Memory\nstuff\x1b[31m here',
        sessions: [
          {
            id: 'sess1234',
            startedAt: '2026-01-01T00:00:00Z',
            lastActivityAt: '2026-01-01T00:00:00Z',
            durationMs: 1000,
            eventCount: 1,
            summaryType: null,
            headline: 'head\x1bline',
            unresolved: ['unre\x1bsolved'],
          },
        ],
      },
      new Date('2026-01-02T00:00:00Z')
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatSprintShow strips ESC from sprint and team name', () => {
    const out = formatSprintShow(
      {
        id: 's1',
        number: 1,
        name: 'sp\x1brint',
        status: 'ACTIVE',
        startDate: null,
        endDate: null,
        startedAt: null,
        closedAt: null,
        team: { id: 'tm1', name: 'te\x1bam' },
      },
      { done: 1, total: 2 },
      []
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatMilestoneShow strips ESC from name, project, description', () => {
    const out = formatMilestoneShow(
      {
        id: 'm1',
        name: 'v1\x1b.0',
        completedAt: null,
        startDate: null,
        targetDate: null,
        archivedAt: null,
        description: 'de\x1bsc',
        projectName: 'pro\x1bj',
        taskCounts: { TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
      },
      []
    )
    expect(out).not.toMatch(/\x1b/)
  })

  it('formatShowOutput strips ESC from doc title, project, body', () => {
    const out = formatShowOutput({
      id: 'd1',
      title: 'Ti\x1btle',
      scope: 'WORKSPACE',
      projectName: 'pro\x1bj',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      revision: 1,
      mentionedTasks: [],
      bodyMarkdown: 'bo\x1bdy',
    })
    expect(out).not.toMatch(/\x1b/)
  })
})
