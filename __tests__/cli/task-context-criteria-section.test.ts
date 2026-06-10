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
    expect(out).not.toContain('验收标准')
  })

  it('renders the contract right after the header, before memory', () => {
    const out = formatTaskContextMarkdown(
      {
        task: TASK,
        criteriaSection: '## 验收标准（合约）\n\n- [MACHINE] tests pass',
        memorySection: '## Relevant Memory\n\n- m',
        sessions: [],
      },
      NOW
    )
    expect(out).toContain('- [MACHINE] tests pass')
    expect(out.indexOf('验收标准')).toBeLessThan(out.indexOf('Relevant Memory'))
    expect(out.indexOf('**Description**')).toBeLessThan(
      out.indexOf('验收标准')
    )
  })
})
