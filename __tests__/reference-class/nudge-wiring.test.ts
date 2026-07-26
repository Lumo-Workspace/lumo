/**
 * LUM-497 — the anchor rides on the existing draft nudge.
 *
 * The nudge's own text is load-bearing (it is what makes an agent draft
 * criteria at all), so the no-anchor output must stay byte-identical.
 */
import { renderCriteriaDraftNudge } from '@/lib/context/render'

// Full literal expected output of renderCriteriaDraftNudge() with no anchor.
// Deliberately hand-typed rather than imported from the module under test:
// pinning this string is the whole point of the review finding (a prior
// version of this suite only asserted renderCriteriaDraftNudge() ===
// renderCriteriaDraftNudge(''), which proves nothing about the actual text —
// a silent edit to the heading, the sentence, or the join character would
// have sailed through green). Any future intentional wording change must
// touch this literal too.
const EXPECTED_NUDGE_NO_ANCHOR =
  '## Acceptance criteria (contract)\n' +
  '\n' +
  'This task has no acceptance criteria yet. Before writing the first line of code: read the task context, draft 3–7 outcome-level acceptance criteria, then submit and lock them with `lumo task criteria set <task> --file <criteria.json>`. Use the HUMAN type for criteria that cannot carry an executable check; repo-wide baselines (tests pass / tsc / i18n parity) do not take slots.'

describe('renderCriteriaDraftNudge', () => {
  it('renders the exact pinned nudge text when no anchor is supplied', () => {
    expect(renderCriteriaDraftNudge()).toBe(EXPECTED_NUDGE_NO_ANCHOR)
  })

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
