/** @jest-environment node */
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const NOW = new Date('2026-06-09T12:00:00Z')

const TASK = {
  identifier: 'LUM-1',
  title: 't',
  status: 'TODO',
  description: 'd',
}

describe('formatTaskContextMarkdown — criteriaSection', () => {
  it('omits the section when criteriaSection is empty/missing', () => {
    const out = formatTaskContextMarkdown(
      { task: TASK, criteriaSection: '', sessions: [] },
      NOW
    )
    expect(out).not.toContain('Acceptance criteria')
  })

  it('renders the contract right after the header, before memory', () => {
    const out = formatTaskContextMarkdown(
      {
        task: TASK,
        criteriaSection: '## Acceptance criteria (contract)\n\n- [MACHINE] tests pass',
        memorySection: '## Relevant Memory\n\n- m',
        sessions: [],
      },
      NOW
    )
    expect(out).toContain('- [MACHINE] tests pass')
    expect(out.indexOf('Acceptance criteria')).toBeLessThan(out.indexOf('Relevant Memory'))
    expect(out.indexOf('**Description**')).toBeLessThan(
      out.indexOf('Acceptance criteria')
    )
  })
})
