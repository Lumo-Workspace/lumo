import { criteriaAuditService } from '../../../lib/services/criteria-audit.service'
import { acceptanceCriterionRepository } from '../../../lib/repositories/acceptance-criterion.repository'

jest.mock('../../../lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listClassifyingFieldsForWorkspace: jest.fn(),
  },
}))

it('tallies effective kinds and computes the self-confirming-green ratio', async () => {
  ;(
    acceptanceCriterionRepository.listClassifyingFieldsForWorkspace as jest.Mock
  ).mockResolvedValue([
    {
      referentKind: 'EXTERNAL_FACT',
      verifierType: 'MACHINE',
      checkpointer: 'git diff origin/main',
    }, // EXTERNAL_FACT
    {
      referentKind: 'EXTERNAL_FACT',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest x',
    }, // UNVERIFIED_ASSERTION
    {
      referentKind: 'AGENT_CONSTRUCTED_STATE',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest y',
    }, // AGENT_CONSTRUCTED_STATE
    { referentKind: null, verifierType: 'MACHINE', checkpointer: 'npx jest z' }, // UNCLASSIFIED
  ])
  const r = await criteriaAuditService.forWorkspace('ws_1')
  expect(r.total).toBe(4)
  expect(r.classified).toBe(3)
  expect(r.byEffectiveKind.EXTERNAL_FACT).toBe(1)
  expect(r.byEffectiveKind.UNVERIFIED_ASSERTION).toBe(1)
  expect(r.byEffectiveKind.AGENT_CONSTRUCTED_STATE).toBe(1)
  expect(r.byEffectiveKind.UNCLASSIFIED).toBe(1)
  // self-confirming green = (AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION) / classified
  expect(r.selfConfirmingGreenRatio).toBeCloseTo(2 / 3)
})
