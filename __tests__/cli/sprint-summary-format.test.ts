/**
 * @jest-environment node
 *
 * LUM-1233 3j: the sprint summary is the `--summary` aspect of `sprint show`
 * (formerly `sprint summary`); its section body.
 */
import { formatSummaryAspect } from '@/cli/src/lib/summary-aspect'

describe('formatSummaryAspect (sprint)', () => {
  it('renders the counts, TL;DR and report', () => {
    const out = formatSummaryAspect({
      stats: { done: 4, total: 6, velocity: 4 },
      tldr: 'Good sprint.',
      report: '## Delivered\n- Billing',
    }).join('\n')
    expect(out).toContain('Done:  4 / 6')
    expect(out).toContain('Good sprint.')
    expect(out).toContain('- Billing')
  })

  it('renders "(no summary generated yet)" when none exists', () => {
    expect(formatSummaryAspect(null)).toEqual(['(no summary generated yet)'])
  })
})
