import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'

describe('LUM-789 isUnmetForDisplay — 渲染口径', () => {
  it('未裁定的 HUMAN 项视作 tacit pass，不计入 unmet', () => {
    expect(isUnmetForDisplay({ verifierType: 'HUMAN' }, undefined)).toBe(false)
  })

  it('未裁定的 MACHINE 项仍计入 unmet（真的没跑过 checkpointer）', () => {
    expect(isUnmetForDisplay({ verifierType: 'MACHINE' }, undefined)).toBe(true)
  })

  it('明确 FAIL 的 HUMAN 项仍计入 unmet（送回是真信号）', () => {
    expect(
      isUnmetForDisplay({ verifierType: 'HUMAN' }, { verdict: 'FAIL' })
    ).toBe(true)
  })

  it('PASS / PASS_WITH_FOLLOWUP 一律不计入 unmet', () => {
    expect(
      isUnmetForDisplay({ verifierType: 'MACHINE' }, { verdict: 'PASS' })
    ).toBe(false)
    expect(
      isUnmetForDisplay(
        { verifierType: 'HUMAN' },
        { verdict: 'PASS_WITH_FOLLOWUP' }
      )
    ).toBe(false)
  })
})
