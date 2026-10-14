/**
 * @jest-environment node
 *
 * LUM-1114 — the settings card's data: per project of the CALLER'S workspace,
 * the compiled rules no detector checks automatically, and why.
 */
jest.mock('@/ee/security/repositories/project-policy.repository', () => ({
  projectPolicyRepository: { activePoliciesForWorkspace: jest.fn() },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn(),
}))

import {
  policyCoverageService,
  uncheckedRules,
} from '@/ee/security/services/policy-coverage.service'
import { projectPolicyRepository } from '@/ee/security/repositories/project-policy.repository'
import { loadSecurityLayers } from '@/ee/security/services/security-workspace-switches.service'
import type { PolicyRule } from '@/lib/policy/types'

const activePolicies =
  projectPolicyRepository.activePoliciesForWorkspace as jest.Mock
const layers = loadSecurityLayers as jest.Mock

const rule = (over: Partial<PolicyRule> & { id: string }): PolicyRule =>
  ({
    text: over.id,
    kind: 'code',
    tier: 'semantic',
    severity: 'LOW',
    blocking: false,
    ...over,
  }) as PolicyRule

const BRANCH_NAMING = rule({
  id: 'branch',
  kind: 'action',
  assertion: 'Branch names follow lumo/<id>-<slug>',
})
const NO_RAW_SQL = rule({ id: 'sql', assertion: 'No raw SQL' })
const PUSH = rule({
  id: 'push',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'push-target', value: 'main' },
})
const REGEX = rule({
  id: 'log',
  tier: 'deterministic',
  predicate: { type: 'diff-regex', value: 'console\\.log' },
})

describe('uncheckedRules', () => {
  it('lists rules no detector consumes, with NO_CHECKER', () => {
    expect(
      uncheckedRules([BRANCH_NAMING, NO_RAW_SQL, PUSH, REGEX], {
        aiJudgeRuns: true,
      })
    ).toEqual([
      {
        ruleId: 'branch',
        text: 'branch',
        kind: 'action',
        reason: 'NO_CHECKER',
      },
    ])
  })

  it('judge-only code rules are unchecked while AI review is off', () => {
    expect(
      uncheckedRules([BRANCH_NAMING, NO_RAW_SQL, PUSH, REGEX], {
        aiJudgeRuns: false,
      }).map(r => [r.ruleId, r.reason])
    ).toEqual([
      ['branch', 'NO_CHECKER'],
      ['sql', 'AI_REVIEW_OFF'],
    ])
  })
})

describe('policyCoverageService.get', () => {
  beforeEach(() => jest.resetAllMocks())

  it('reads only the caller workspace and reports each project', async () => {
    activePolicies.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Lumo',
        policy: {
          compiledAt: new Date('2026-10-11T13:23:16Z'),
          rules: [BRANCH_NAMING, NO_RAW_SQL, PUSH],
        },
      },
      { projectId: 'p2', projectName: 'Growth', policy: null },
    ])
    layers.mockResolvedValue({ scan: true, aiReview: true })
    const out = await policyCoverageService.get({ workspaceId: 'ws-a' })
    expect(activePolicies).toHaveBeenCalledWith('ws-a')
    expect(layers).toHaveBeenCalledWith('ws-a')
    expect(out.projects).toEqual([
      {
        projectId: 'p1',
        projectName: 'Lumo',
        compiledAt: '2026-10-11T13:23:16.000Z',
        totalRules: 3,
        unchecked: [
          {
            ruleId: 'branch',
            text: 'branch',
            kind: 'action',
            reason: 'NO_CHECKER',
          },
        ],
      },
      {
        projectId: 'p2',
        projectName: 'Growth',
        compiledAt: null,
        totalRules: 0,
        unchecked: [],
      },
    ])
  })

  it('the master scan switch off also stops the judge', async () => {
    activePolicies.mockResolvedValue([
      {
        projectId: 'p1',
        projectName: 'Lumo',
        policy: { compiledAt: new Date(), rules: [NO_RAW_SQL] },
      },
    ])
    layers.mockResolvedValue({ scan: false, aiReview: true })
    const out = await policyCoverageService.get({ workspaceId: 'ws-a' })
    expect(out.projects[0]?.unchecked.map(r => r.reason)).toEqual([
      'AI_REVIEW_OFF',
    ])
  })
})
