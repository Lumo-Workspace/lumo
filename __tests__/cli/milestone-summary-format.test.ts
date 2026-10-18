/**
 * @jest-environment node
 *
 * LUM-1233 3j: the milestone summary is the `--summary` aspect of
 * `milestone show` (formerly `milestone summary`); its section body.
 */
import { formatSummaryAspect } from '@/cli/src/lib/summary-aspect'

describe('formatSummaryAspect (milestone)', () => {
  it('renders the counts, TL;DR and full report when all fields are present', () => {
    const out = formatSummaryAspect({
      stats: { done: 8, total: 10 },
      tldr: 'Hit the scope, two tasks slipped.',
      report: '## Summary\nShipped the core.\n\n## Delivered\n- OAuth',
    }).join('\n')
    expect(out).toContain('Done:  8 / 10')
    expect(out).toContain('Hit the scope, two tasks slipped.')
    expect(out).toContain('## Summary')
    expect(out).toContain('- OAuth')
  })

  it('renders "(no summary generated yet)" for none (404) or an empty row', () => {
    expect(formatSummaryAspect(null)).toEqual(['(no summary generated yet)'])
    expect(
      formatSummaryAspect({ stats: null, tldr: null, report: null })
    ).toEqual(['(no summary generated yet)'])
  })

  it('a failed read is one line, not a failed show', () => {
    expect(formatSummaryAspect({ error: 'HTTP 500' })).toEqual([
      'Could not read (HTTP 500)',
    ])
  })
})
