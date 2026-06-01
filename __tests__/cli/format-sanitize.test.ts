/**
 * @jest-environment node
 */
import { formatTaskListTable } from '@/cli/src/lib/format'
import { formatSprintUpdateSummary } from '@/cli/src/commands/sprint-update'
import { formatMilestoneUpdateSummary } from '@/cli/src/commands/milestone-update'
import { formatSprintSummary } from '@/cli/src/commands/sprint-summary'

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
      { name: 'v1\x1b.0', status: 'planned' },
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
})
