/**
 * @jest-environment node
 */
import { formatMilestoneSummary } from '@/cli/src/commands/milestone-summary'

describe('formatMilestoneSummary', () => {
  it('renders milestone header and full summary when all fields present', () => {
    const out = formatMilestoneSummary({
      name: 'v1.0',
      stats: { done: 8, total: 10 },
      tldr: 'Hit the scope, two tasks slipped.',
      report: '## Summary\nShipped the core.\n\n## Delivered\n- OAuth',
    })
    expect(out).toContain('Milestone: v1.0')
    expect(out).toContain('Done:      8 / 10')
    expect(out).toContain('Hit the scope, two tasks slipped.')
    expect(out).toContain('## Summary')
    expect(out).toContain('- OAuth')
  })

  it('renders "(no summary generated yet)" when stats, tldr, and report are all null', () => {
    const out = formatMilestoneSummary({
      name: 'v2.0',
      stats: null,
      tldr: null,
      report: null,
    })
    expect(out).toContain('Milestone: v2.0')
    expect(out).toContain('(no summary generated yet)')
  })
})
