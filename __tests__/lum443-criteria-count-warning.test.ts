import { criteriaCountWarning } from '@/lib/validation/acceptance'

const M = { verifierType: 'MACHINE' as const }
const H = { verifierType: 'HUMAN' as const }

describe('criteriaCountWarning counts only human criteria for the cap', () => {
  it('criteriaCountWarning counts only human criteria — many machine + in-range human is clean', () => {
    const contract = [...Array(10).fill(M), ...Array(4).fill(H)]
    expect(criteriaCountWarning(contract)).toBeNull()
  })

  it('criteriaCountWarning counts only human criteria — machine count never trips the max', () => {
    const contract = [...Array(20).fill(M), ...Array(3).fill(H)]
    expect(criteriaCountWarning(contract)).toBeNull()
  })

  it('criteriaCountWarning counts only human criteria — >7 human trips the max', () => {
    const contract = [...Array(2).fill(M), ...Array(8).fill(H)]
    expect(criteriaCountWarning(contract)).toMatch(
      /exceeds the recommended maximum/
    )
  })

  it('criteriaCountWarning counts only human criteria — tiny total still warns under min', () => {
    expect(criteriaCountWarning([H])).toMatch(/below the recommended minimum/)
  })
})
