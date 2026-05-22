/** @jest-environment node */
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const NOW = new Date('2026-05-19T12:00:00Z')

describe('formatTaskContextMarkdown — webLinkSection', () => {
  it('omits the section when webLinkSection is empty/missing', () => {
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
        webLinkSection: '',
        sessions: [],
      },
      NOW
    )
    expect(out).not.toContain('Web Links')
  })

  it('inserts the section between slack context and sessions', () => {
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
        webLinkSection: '## Web Links\n\n- https://example.com',
        sessions: [],
      },
      NOW
    )
    // Order: slack → web links → sessions
    expect(out.indexOf('Slack Context')).toBeLessThan(out.indexOf('Web Links'))
    expect(out.indexOf('Web Links')).toBeLessThan(
      out.indexOf('Previous Sessions')
    )
  })

  it('renders web links section without slack context present', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-2',
          title: 'task',
          status: 'IN_PROGRESS',
          description: null,
        },
        webLinkSection: '## Web Links\n\n- https://example.com/pr/42',
        sessions: [],
      },
      NOW
    )
    expect(out).toContain('Web Links')
    expect(out).toContain('https://example.com/pr/42')
    expect(out.indexOf('Web Links')).toBeLessThan(
      out.indexOf('Previous Sessions')
    )
  })
})
