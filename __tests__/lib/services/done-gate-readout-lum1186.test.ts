/**
 * @jest-environment node
 *
 * LUM-1186 — the Done gate served by the task-status read model:
 * `readDoneGateInputs` (server reads, fail-closed) + `doneGateReadout` (pure)
 * must give the SAME gate as the web Record tab (`deriveRecordGaps` +
 * `deriveDoneGate`) for one fixture — blocked (proven defect), ready and
 * accepted — and `readDoneGatePluginRow` reports the plugin plane.
 */
const mockDoneGates: Array<{
  id: string
  openBlockers: jest.Mock
  checked?: jest.Mock
}> = []
jest.mock('@/lib/plugins/registry', () => ({
  getPluginRegistry: () => ({ doneGates: mockDoneGates }),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findGateFieldsByTask: jest.fn(),
    isGateEnabledForWorkspace: jest.fn(),
    findUndispositionedByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { listForTask: jest.fn(), runsPerCase: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { readDoneGateInputs } from '@/lib/services/done-verdict.service'
import { readDoneGatePluginRow } from '@/lib/plugins/done-gate'
import { doneGateReadout, deriveDoneGate } from '@/lib/acceptance/done-gate'
import { deriveRecordGaps } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/record-gaps'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

const findCrossings =
  boundaryCrossingRepository.findGateFieldsByTask as jest.Mock
const gateEnabled =
  boundaryCrossingRepository.isGateEnabledForWorkspace as jest.Mock
const listCases = testCaseRepository.listForTask as jest.Mock
const runsPerCase = testCaseRepository.runsPerCase as jest.Mock

type Crossing = {
  disposition: string | null
  advisory: boolean
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
}

function run(
  id: string,
  result: 'PASS' | 'FAIL',
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    result,
    environment: 'LOCAL',
    failureAttribution: null,
    unprovenVerification: [],
    evidence: [{ kind: 'file', name: 'jest.json' }],
    stepResults: null,
    disposition: null,
    ...extra,
  }
}

const CASES = [
  { id: 'c1', number: 1, title: 'login', requiredEnvironment: null },
  { id: 'c2', number: 2, title: 'logout', requiredEnvironment: null },
]

function fixture(opts: {
  crossings: Crossing[]
  defectRuled: boolean
  defect: boolean
  securityBlocking: number
  scanned: boolean
}) {
  findCrossings.mockResolvedValue(opts.crossings)
  gateEnabled.mockResolvedValue(true)
  listCases.mockResolvedValue(CASES)
  const runs = new Map([
    ['c1', [run('r1', 'PASS')]],
    [
      'c2',
      [
        opts.defect
          ? run('r2', 'FAIL', {
              failureAttribution: 'IMPLEMENTATION_DEFECT',
              disposition: opts.defectRuled ? 'KNOWN_DEFECT' : null,
            })
          : run('r2', 'PASS'),
      ],
    ],
  ])
  runsPerCase.mockResolvedValue(runs)
  mockDoneGates.length = 0
  mockDoneGates.push({
    id: 'security',
    openBlockers: jest.fn(async () =>
      Array.from({ length: opts.securityBlocking }, (_, i) => ({
        ruleId: `r${i}`,
        filePath: 'a.ts',
      }))
    ),
    checked: jest.fn(async () => opts.scanned),
  })
  // The web path over the same fixture: the crossings list, the plugin's
  // blocking/checked, and summarizeTestCases over the cases + runs.
  const web = (taskStatus: string) => {
    const summary = summarizeTestCases(
      CASES.map(c => ({
        ...c,
        runs: runs.get(c.id) ?? [],
      })) as unknown as Parameters<typeof summarizeTestCases>[0]
    )
    return deriveDoneGate(
      deriveRecordGaps({
        taskStatus,
        crossings: opts.crossings as unknown as Parameters<
          typeof deriveRecordGaps
        >[0]['crossings'],
        gateEnabled: true,
        securityBlocking: opts.securityBlocking,
        testsBlocking: summary.blocking.length,
      }),
      {
        securityScanned: opts.scanned,
        showSecurity: true,
        tests: { total: summary.total, passing: summary.passing },
      }
    )
  }
  return { web }
}

describe('Done gate read-out (LUM-1186) matches the web Record tab', () => {
  it('blocked: an unruled proven defect blocks, same as the web gate', async () => {
    const { web } = fixture({
      crossings: [{ disposition: null, advisory: true, severity: 'LOW' }],
      defect: true,
      defectRuled: false,
      securityBlocking: 0,
      scanned: false,
    })
    const out = doneGateReadout(
      await readDoneGateInputs('t-1', 'w-1'),
      'IN_REVIEW'
    )
    expect(out).toEqual({ confirmed: true, ...web('IN_REVIEW') })
    expect(out).toMatchObject({
      headline: 'blocked',
      blockingTotal: 1,
      crossings: { state: 'advisory', advisory: 1 },
      security: { state: 'notScanned' },
      tests: { state: 'blocked', blocking: 1, passing: 1, total: 2 },
    })
  })

  it('ready: a ruled-on defect no longer blocks', async () => {
    const { web } = fixture({
      crossings: [
        { disposition: 'FALSE_POSITIVE', advisory: false, severity: 'HIGH' },
      ],
      defect: true,
      defectRuled: true,
      securityBlocking: 0,
      scanned: true,
    })
    const out = doneGateReadout(
      await readDoneGateInputs('t-1', 'w-1'),
      'IN_REVIEW'
    )
    expect(out).toEqual({ confirmed: true, ...web('IN_REVIEW') })
    expect(out).toMatchObject({
      headline: 'ready',
      crossings: { state: 'clear', dispositioned: 1, total: 1 },
      security: { state: 'clear' },
      tests: { state: 'clear', passing: 1, total: 2 },
    })
  })

  it('accepted: a DONE task reads accepted', async () => {
    const { web } = fixture({
      crossings: [],
      defect: false,
      defectRuled: false,
      securityBlocking: 0,
      scanned: true,
    })
    const out = doneGateReadout(await readDoneGateInputs('t-1', 'w-1'), 'DONE')
    expect(out).toEqual({ confirmed: true, ...web('DONE') })
    expect(out).toMatchObject({
      headline: 'accepted',
      crossings: { state: 'none' },
      tests: { passing: 2, total: 2 },
    })
  })

  it('applies the workspace gate opt-out exactly like the DONE gate', async () => {
    fixture({
      crossings: [
        { disposition: null, advisory: false, severity: 'LOW' },
        { disposition: null, advisory: false, severity: 'HIGH' },
      ],
      defect: false,
      defectRuled: false,
      securityBlocking: 2,
      scanned: true,
    })
    gateEnabled.mockResolvedValue(false)
    const out = doneGateReadout(
      await readDoneGateInputs('t-1', 'w-1'),
      'IN_PROGRESS'
    )
    expect(out).toMatchObject({
      headline: 'blocked',
      blockingTotal: 3,
      crossings: { state: 'blocked', blocking: 1, advisory: 1 },
      security: { state: 'blocked', blocking: 2 },
    })
    expect(gateEnabled).toHaveBeenCalledWith('w-1')
  })

  it('fails closed: a plane that cannot be read makes the gate unconfirmed', async () => {
    fixture({
      crossings: [],
      defect: false,
      defectRuled: false,
      securityBlocking: 0,
      scanned: true,
    })
    listCases.mockRejectedValue(new Error('db down'))
    mockDoneGates[0]!.openBlockers.mockRejectedValue(new Error('boom'))
    const inputs = await readDoneGateInputs('t-1', 'w-1')
    expect(inputs).toEqual({
      confirmed: false,
      unconfirmed: ['security findings', 'test cases'],
    })
    expect(doneGateReadout(inputs, 'DONE')).toEqual(inputs)
  })
})

describe('readDoneGatePluginRow (LUM-1186)', () => {
  beforeEach(() => {
    mockDoneGates.length = 0
  })

  it('no plugin → no row (present: false)', async () => {
    await expect(readDoneGatePluginRow('t-1')).resolves.toEqual({
      present: false,
      blocking: 0,
      checked: false,
    })
  })

  it('a contributor without checked() is never reported as checked', async () => {
    mockDoneGates.push({
      id: 'x',
      openBlockers: jest.fn(async () => [{ ruleId: 'r', filePath: 'f' }]),
    })
    await expect(readDoneGatePluginRow('t-1')).resolves.toEqual({
      present: true,
      blocking: 1,
      checked: false,
    })
  })

  it('checked when any contributor has a result', async () => {
    mockDoneGates.push(
      {
        id: 'a',
        openBlockers: jest.fn(async () => []),
        checked: jest.fn(async () => false),
      },
      {
        id: 'b',
        openBlockers: jest.fn(async () => []),
        checked: jest.fn(async () => true),
      }
    )
    await expect(readDoneGatePluginRow('t-1')).resolves.toMatchObject({
      checked: true,
    })
  })
})
