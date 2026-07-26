/**
 * LUM-497 — anchor rendering.
 *
 * Four states, one hard size limit. "Insufficient sample" is a correct
 * output, not a degraded one: a distribution over 3 tasks reads as evidence
 * while carrying none.
 */
import {
  renderReferenceClassAnchor,
  ANCHOR_MAX_LINES,
  type ReferenceClassAnchor,
} from '@/lib/reference-class'

function nonEmptyLines(s: string): string[] {
  return s.split('\n').filter(l => l.trim() !== '')
}

const full: ReferenceClassAnchor = {
  kind: 'READY',
  level: 'MILESTONE',
  label: 'Trust and cognitive load',
  size: 14,
  rejections: [
    { key: 'EVIDENCE_INSUFFICIENT', count: 5 },
    { key: 'SCOPE_MISMATCH', count: 3 },
  ],
  crossings: [{ key: 'TEST_TAMPERING', count: 3 }],
  postStartContractTasks: 9,
}

describe('renderReferenceClassAnchor', () => {
  it('names the layer and the sample size it is based on', () => {
    const out = renderReferenceClassAnchor(full)
    expect(out).toContain('14 delivered tasks')
    expect(out).toContain('Trust and cognitive load')
  })

  it('reports raw fractions, never percentages', () => {
    const out = renderReferenceClassAnchor(full)
    expect(out).toContain('5/14')
    expect(out).not.toMatch(/\d+%/)
  })

  it('stays within the hard line limit', () => {
    expect(
      nonEmptyLines(renderReferenceClassAnchor(full)).length
    ).toBeLessThanOrEqual(ANCHOR_MAX_LINES)
  })

  it('says so plainly when the sample is insufficient', () => {
    const out = renderReferenceClassAnchor({ kind: 'INSUFFICIENT' })
    expect(out).toContain('Insufficient sample')
    expect(out).not.toMatch(/\d+\/\d+/)
  })

  it('omits a signal line entirely rather than printing a zero', () => {
    const out = renderReferenceClassAnchor({ ...full, crossings: [] })
    expect(out).not.toContain('boundary crossing')
    expect(out).not.toContain('0/14')
  })

  it('states the basis when the class is clean, instead of dropping the block', () => {
    const out = renderReferenceClassAnchor({
      ...full,
      rejections: [],
      crossings: [],
      postStartContractTasks: 0,
    })
    expect(out).toContain('14 delivered tasks')
    expect(out).toContain('no recorded send-backs')
  })

  it('strips control characters from the scope name', () => {
    // Built via fromCharCode rather than a literal escape: a literal control
    // byte does not survive tool-call transport/copy-paste (it gets silently
    // dropped in places), which would make a naive `not.toContain(bel)`
    // assertion pass vacuously.
    const bel = String.fromCharCode(7)
    const out = renderReferenceClassAnchor({
      ...full,
      label: `weir${bel}d`,
    })
    expect(out).toContain('weird')
    expect(out).not.toContain(bel)
  })
})
