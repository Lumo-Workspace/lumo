/** @jest-environment node */
// LUM-835 — the replay's pass rule, and that its variants keep the shapes the
// fix is about. The replay itself calls the real model (a contract
// checkpointer, not a unit test).
import { VARIANTS, variantPasses } from '@/scripts/security/falsifier-replay'

describe('falsifier replay', () => {
  it('a text-only reason must never REJECT; a real mitigation must REJECT in at least two of three', () => {
    expect(
      variantPasses('never-reject', ['INCONCLUSIVE', 'INCONCLUSIVE'])
    ).toBe(true)
    expect(variantPasses('never-reject', ['INCONCLUSIVE', 'REJECT'])).toBe(
      false
    )
    expect(variantPasses('reject', ['REJECT', 'REJECT', 'INCONCLUSIVE'])).toBe(
      true
    )
    expect(
      variantPasses('reject', ['REJECT', 'INCONCLUSIVE', 'INCONCLUSIVE'])
    ).toBe(false)
  })

  it('covers a comment-only "test harness", a comment-only "sanitised", and a real allow-list', () => {
    const byLabel = Object.fromEntries(VARIANTS.map(v => [v.label, v]))
    const harness = byLabel['comment claims a test harness']!
    expect(harness.expect).toBe('never-reject')
    expect(harness.lines.join('\n')).toMatch(/\/\/ .*test harness/)
    expect(harness.lines.join('\n')).toContain('exec(`echo ${body}`)')
    const sanitised = byLabel['comment claims input is sanitised and internal']!
    expect(sanitised.expect).toBe('never-reject')
    expect(sanitised.lines.join('\n')).toMatch(/\/\/ .*sanitised/)
    const mitigated = byLabel['real allow-list executes before the shell call']!
    expect(mitigated.expect).toBe('reject')
    const src = mitigated.lines.join('\n')
    // The check executes BEFORE the sink.
    expect(src.indexOf('.test(body)')).toBeLessThan(src.indexOf('exec(`'))
  })
})
