import { formatAuditReport } from '../../src/commands/criteria-audit'

it('renders the distribution and the self-confirming-green headline', () => {
  const out = formatAuditReport({
    total: 4,
    classified: 3,
    byEffectiveKind: {
      EXTERNAL_FACT: 1,
      AGENT_CONSTRUCTED_STATE: 1,
      PENDING_OUTCOME: 0,
      UNVERIFIED_ASSERTION: 1,
      UNCLASSIFIED: 1,
    },
    selfConfirmingGreenRatio: 2 / 3,
  })
  expect(out).toMatch(/EXTERNAL_FACT\s+1/)
  expect(out).toMatch(/UNVERIFIED_ASSERTION\s+1/)
  expect(out).toMatch(/UNCLASSIFIED\s+1/)
  expect(out).toMatch(/67%|66\.7%|0\.67/)
  expect(out).toMatch(/self-confirming/i)
})
