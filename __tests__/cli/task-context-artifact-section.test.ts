/** @jest-environment node */
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'

const NOW = new Date('2026-05-29T12:00:00Z')

describe('formatTaskContextMarkdown — artifactSection', () => {
  it('omits the section when artifactSection is empty/missing', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 't',
          status: 'TODO',
          description: 'd',
        },
        artifactSection: '',
        sessions: [],
      },
      NOW
    )
    expect(out).not.toContain('[spec]')
  })

  it('inserts artifacts after figma and before sessions', () => {
    const out = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-1',
          title: 't',
          status: 'TODO',
          description: 'd',
        },
        figmaSection: '## Figma Designs\n\n- **F**',
        artifactSection: '## [spec] Spec\n\n## Requirements',
        sessions: [],
      },
      NOW
    )
    expect(out.indexOf('Figma Designs')).toBeLessThan(
      out.indexOf('[spec] Spec')
    )
    expect(out.indexOf('[spec] Spec')).toBeLessThan(
      out.indexOf('Previous Sessions')
    )
  })
})
