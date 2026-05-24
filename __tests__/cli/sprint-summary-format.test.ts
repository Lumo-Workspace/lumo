/**
 * @jest-environment node
 */
import { formatSprintSummary } from '@/cli/src/commands/sprint-summary'

describe('formatSprintSummary', () => {
  it('renders sprint header and full summary when all fields present', () => {
    const out = formatSprintSummary({
      number: 4,
      name: 'Sprint 4',
      stats: { done: 8, total: 10, velocity: 42 },
      tldr: 'Solid sprint, shipped auth and billing.',
      report: '## Highlights\n- Shipped OAuth\n- Fixed billing bug',
    })
    expect(out).toContain('Sprint: #4 Sprint 4')
    expect(out).toContain('Done:   8 / 10')
    expect(out).toContain('Solid sprint, shipped auth and billing.')
    expect(out).toContain('## Highlights')
    expect(out).toContain('- Shipped OAuth')
  })

  it('renders "(no summary generated yet)" when stats, tldr, and report are all null', () => {
    const out = formatSprintSummary({
      number: 2,
      name: 'Sprint 2',
      stats: null,
      tldr: null,
      report: null,
    })
    expect(out).toContain('Sprint: #2 Sprint 2')
    expect(out).toContain('(no summary generated yet)')
  })
})
