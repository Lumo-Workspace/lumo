/**
 * LUM-497 — the anchor rides on the existing draft nudge.
 *
 * The nudge's own text is load-bearing (it is what makes an agent draft
 * criteria at all), so the no-anchor output must stay byte-identical.
 */
import { renderCriteriaDraftNudge } from '@/lib/context/render'

describe('renderCriteriaDraftNudge', () => {
  it('is unchanged when no anchor is supplied', () => {
    expect(renderCriteriaDraftNudge()).toBe(renderCriteriaDraftNudge(''))
    expect(renderCriteriaDraftNudge()).toContain(
      'This task has no acceptance criteria yet.'
    )
    expect(renderCriteriaDraftNudge()).not.toContain('Reference class')
  })

  it('appends the anchor below the nudge, separated by a blank line', () => {
    const out = renderCriteriaDraftNudge(
      '### Reference class (outside view)\n\nBased on: 9 delivered tasks'
    )
    expect(out).toContain('This task has no acceptance criteria yet.')
    expect(out).toContain('### Reference class (outside view)')
    expect(out.indexOf('no acceptance criteria')).toBeLessThan(
      out.indexOf('Reference class')
    )
    expect(out).toContain('\n\n### Reference class')
  })

  it('keeps the contract heading first so existing readers still parse it', () => {
    const out = renderCriteriaDraftNudge('### Reference class (outside view)')
    expect(out.startsWith('## Acceptance criteria (contract)')).toBe(true)
  })
})
