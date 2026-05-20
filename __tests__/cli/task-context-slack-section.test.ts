/** @jest-environment node */
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const NOW = new Date('2026-05-19T12:00:00Z')

describe('formatTaskContextMarkdown — slackContextSection', () => {
  it('omits the section when slackContextSection is empty/missing', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 't',
          status: 'TODO',
          description: 'd',
        },
        memorySection: '',
        slackContextSection: '',
        sessions: [],
      },
      NOW
    )
    expect(out).not.toContain('Slack Context')
  })

  it('inserts the section between memory and sessions', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 't',
          status: 'TODO',
          description: 'd',
        },
        memorySection: '## Relevant Memory\n- foo',
        slackContextSection: '## Slack Context\n\n### #design · Single message',
        sessions: [],
      },
      NOW
    )
    // Order: memory → slack → sessions
    expect(out.indexOf('Relevant Memory')).toBeLessThan(
      out.indexOf('Slack Context')
    )
    expect(out.indexOf('Slack Context')).toBeLessThan(
      out.indexOf('Previous Sessions')
    )
  })
})
