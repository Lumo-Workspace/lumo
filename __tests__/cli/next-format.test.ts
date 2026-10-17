/**
 * @jest-environment node
 */
import { formatNextOutput } from '@/cli/src/commands/next'
import type { RankedTask } from '@/cli/src/lib/rank-tasks'

function ranked(
  over: Partial<RankedTask> & { identifier: string }
): RankedTask {
  return {
    task: {
      id: 'c1',
      number: 1,
      title: 'A title',
      status: 'TODO',
      priority: 'MEDIUM',
      teamIdentifier: 'LUM',
      sprintId: null,
      dueDate: null,
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    reasons: ['MEDIUM'],
    ...over,
  }
}

describe('formatNextOutput', () => {
  it('renders header, numbered rows with reason lines, and a Next footer', () => {
    const out = formatNextOutput(
      [
        ranked({
          identifier: 'LUM-42',
          task: {
            id: 'c42',
            number: 42,
            title: 'Fix Slack OAuth redirect',
            status: 'IN_PROGRESS',
            priority: 'URGENT',
            teamIdentifier: 'LUM',
            sprintId: 's1',
            dueDate: '2026-06-03T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
          reasons: ['URGENT', 'active sprint', 'due 2026-06-03', 'in progress'],
        }),
        ranked({ identifier: 'LUM-48', reasons: ['HIGH'] }),
      ],
      12
    )
    expect(out).toContain('Top 2 recommended tasks (of 12 open):')
    expect(out).toContain('1. LUM-42')
    expect(out).toContain(
      '↳ URGENT · active sprint · due 2026-06-03 · in progress'
    )
    expect(out).toContain('2. LUM-48')
    // LUM-686: the footer moved to the shared renderer — heading on its own
    // line, command indented beneath it. Same advice, same command string.
    expect(out).toContain('Next:')
    expect(out).toContain(
      'lumo session attach LUM-42 && lumo task context LUM-42'
    )
    expect(out).toContain(
      'Hint: any other task in the list works the same way.'
    )
  })

  it('uses singular wording and omits the "pick any" note for a single task', () => {
    const out = formatNextOutput([ranked({ identifier: 'LUM-7' })], 1)
    expect(out).toContain('Top 1 recommended task (of 1 open):')
    expect(out).not.toContain(
      'Hint: any other task in the list works the same way.'
    )
  })

  it('returns the empty-state line when there are no tasks', () => {
    expect(formatNextOutput([], 0)).toBe('No open tasks assigned to you.')
  })

  it('strips control characters from the title', () => {
    const out = formatNextOutput(
      [
        ranked({
          identifier: 'LUM-9',
          task: {
            ...ranked({ identifier: 'LUM-9' }).task,
            title: 'Ti\x1b[31mtle',
          },
        }),
      ],
      1
    )
    expect(out).not.toMatch(/\x1b/)
    expect(out).toContain('Ti[31mtle')
  })
})
