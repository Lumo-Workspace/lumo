import { acceptanceCriterionRepository } from '../../../lib/repositories/acceptance-criterion.repository'

jest.mock('../../../lib/db/prisma', () => ({
  prisma: { acceptanceCriterion: { findMany: jest.fn() } },
}))
import { prisma } from '../../../lib/db/prisma'

it('listClassifyingFieldsForWorkspace selects active criteria scoped to the workspace', async () => {
  ;(prisma.acceptanceCriterion.findMany as jest.Mock).mockResolvedValue([
    {
      referentKind: 'EXTERNAL_FACT',
      verifierType: 'MACHINE',
      checkpointer: 'git diff',
    },
  ])
  const rows =
    await acceptanceCriterionRepository.listClassifyingFieldsForWorkspace(
      'ws_1'
    )
  expect(rows).toHaveLength(1)
  const call = (prisma.acceptanceCriterion.findMany as jest.Mock).mock
    .calls[0][0]
  expect(call.where.deletedAt).toBeNull()
  expect(call.where.task.project.workspaceId).toBe('ws_1')
  expect(call.select).toEqual({
    referentKind: true,
    verifierType: true,
    checkpointer: true,
  })
})
