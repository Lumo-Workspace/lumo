/**
 * @jest-environment node
 *
 * LUM-689 — which ideas a Gate-C draft consumes.
 *
 * Gate C used to resolve a draft's ideaIds from the CLUSTER stage record, but a
 * confirmed clustering (`ClusterGateCluster`) is `{name, thrust, ideaIds}` and
 * carries no `clusterId` at all — cluster identity there is positional. The
 * lookup therefore matched nothing, every draft rendered with an empty idea
 * list, and materialisation consumed no ideas: none ever reached PLANNED.
 *
 * The authority is gate B's confirmation, which carries both the clusterId the
 * drafts are keyed by and the ideas the reviewer actually kept (LUM-688).
 */
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: { findById: jest.fn(), findStageRecord: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByWorkspaceNonIdea: jest.fn() },
}))
jest.mock('@/lib/repositories/plan-materialize.repository', () => ({
  planMaterializeRepository: { materialize: jest.fn() },
}))

import { planMaterializeService } from '@/lib/services/plan-materialize.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { projectRepository } from '@/lib/repositories/project.repository'

const mockRepo = planRunRepository as jest.Mocked<typeof planRunRepository>
const mockProjects = projectRepository as jest.Mocked<typeof projectRepository>

const RUN_ID = 'run_1'
const WORKSPACE_ID = 'ws_1'

/** Gate A's confirmed clustering — positional identity, no clusterId field. */
const CLUSTER_RECORD = {
  humanConfirmedOutput: {
    clusters: [
      { name: 'Converter wiring', thrust: 'unblock', ideaIds: ['i1', 'i2'] },
    ],
    orphans: [],
  },
} as never

/** Gate B's confirmation — clusterId + the ideas kept for this plan. */
const ALIGN_RECORD = {
  humanConfirmedOutput: {
    clusters: [
      {
        clusterId: 'cluster-0',
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'on priority',
        customizationTrap: false,
        ideaIds: ['i1'],
      },
    ],
  },
} as never

const GENERATE_RECORD = {
  llmRawOutput: {
    drafts: [
      {
        clusterId: 'cluster-0',
        goalStatement: 'Wire the last hop',
        tasks: [{ title: 't', why: 'w', size: 'S' }],
        assumptionNote: 'a',
      },
    ],
    prose: 'do this first',
  },
} as never

beforeEach(() => {
  jest.clearAllMocks()
  mockRepo.findById.mockResolvedValue({
    id: RUN_ID,
    workspaceId: WORKSPACE_ID,
    stage: 'DRAFT_READY',
    proseDocument: null,
  } as never)
  mockRepo.findStageRecord.mockImplementation(async (_id, kind) => {
    if (kind === 'ALIGN') return ALIGN_RECORD
    if (kind === 'GENERATE') return GENERATE_RECORD
    return CLUSTER_RECORD
  })
  mockProjects.findByWorkspaceNonIdea.mockResolvedValue([
    { id: 'proj_1', name: 'Lumo' },
  ] as never)
})

it('draft ideaIds come from the gate-B confirmed alignment', async () => {
  const data = await planMaterializeService.getGateData({
    planRunId: RUN_ID,
    workspaceId: WORKSPACE_ID,
  })

  expect(data.drafts).toHaveLength(1)
  // Non-empty is the whole point: an empty list here means materialisation
  // consumes nothing and no idea is ever marked PLANNED.
  expect(data.drafts[0]!.ideaIds).toEqual(['i1'])
})

it('a draft whose cluster has no gate-B entry renders with no linked ideas', async () => {
  mockRepo.findStageRecord.mockImplementation(async (_id, kind) => {
    if (kind === 'ALIGN') return { humanConfirmedOutput: null } as never
    if (kind === 'GENERATE') return GENERATE_RECORD
    return CLUSTER_RECORD
  })

  const data = await planMaterializeService.getGateData({
    planRunId: RUN_ID,
    workspaceId: WORKSPACE_ID,
  })

  // Best-effort: gate C still opens, the draft just claims no ideas.
  expect(data.drafts[0]!.ideaIds).toEqual([])
})
