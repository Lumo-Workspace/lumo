/**
 * @jest-environment node
 *
 * LUM-740 — the workspace security policy table (spec §6 L5): which
 * { provenance, severity } pairs block DONE. null = the 732 default;
 * LLM_JUDGE can never block, at the API edge and at the reader.
 */
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findLatestByPullRequestIds: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyForSecurityByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSecurityPolicy: jest.fn() },
}))

import {
  DEFAULT_SECURITY_POLICY,
  parseSecurityPolicy,
  securityPolicySchema,
  isBlockingUnderPolicy,
  type PolicyFindingInput,
  type SecurityPolicy,
} from '@/lib/security-scan/policy'
import {
  isBlockingFinding,
  listOpenBlockingFindings,
} from '@/lib/services/pr-security-scan-gate'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'

const scans = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const prs = pullRequestRepository.findManyForSecurityByTaskId as jest.Mock
const policyOf = workspaceRepository.findSecurityPolicy as jest.Mock

type OpenFinding = PolicyFindingInput & { ruleId?: string; filePath?: string }
const open = (over: Partial<OpenFinding>): OpenFinding => ({
  provenance: 'EXTERNAL_TOOL',
  severity: 'MEDIUM',
  disposition: null,
  persisting: false,
  ...over,
})

describe('LUM-740 security policy', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('parseSecurityPolicy', () => {
    it('falls back to the 732 default (DETERMINISTIC HIGH only) for null or garbage', () => {
      expect(parseSecurityPolicy(null)).toEqual(DEFAULT_SECURITY_POLICY)
      expect(parseSecurityPolicy(undefined)).toEqual(DEFAULT_SECURITY_POLICY)
      expect(parseSecurityPolicy('nope')).toEqual(DEFAULT_SECURITY_POLICY)
      expect(parseSecurityPolicy({ block: 'x' })).toEqual(
        DEFAULT_SECURITY_POLICY
      )
      expect(DEFAULT_SECURITY_POLICY).toEqual({
        block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }],
      })
    })

    it('keeps a configured pair', () => {
      expect(
        parseSecurityPolicy({
          block: [{ provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' }],
        })
      ).toEqual({
        block: [{ provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' }],
      })
    })

    it('drops an LLM_JUDGE entry from a hand-edited row and keeps the rest', () => {
      expect(
        parseSecurityPolicy({
          block: [
            { provenance: 'LLM_JUDGE', severity: 'HIGH' },
            { provenance: 'DETERMINISTIC', severity: 'MEDIUM' },
          ],
        })
      ).toEqual({
        block: [{ provenance: 'DETERMINISTIC', severity: 'MEDIUM' }],
      })
    })

    it('an empty block list is a valid "nothing blocks" policy, not the default', () => {
      expect(parseSecurityPolicy({ block: [] })).toEqual({ block: [] })
    })

    it('a non-empty list with no legal rule is the default, never "nothing blocks" by accident', () => {
      expect(
        parseSecurityPolicy({
          block: [{ provenance: 'DETERMINSTIC', severity: 'HIGH' }],
        })
      ).toEqual(DEFAULT_SECURITY_POLICY)
      expect(
        parseSecurityPolicy({
          block: [{ provenance: 'LLM_JUDGE', severity: 'HIGH' }],
        })
      ).toEqual(DEFAULT_SECURITY_POLICY)
    })
  })

  describe('securityPolicySchema (the API edge)', () => {
    it('refuses LLM_JUDGE outright', () => {
      const r = securityPolicySchema.safeParse({
        block: [{ provenance: 'LLM_JUDGE', severity: 'HIGH' }],
      })
      expect(r.success).toBe(false)
    })
    it('refuses unknown keys and unknown severities', () => {
      expect(
        securityPolicySchema.safeParse({ block: [], extra: 1 }).success
      ).toBe(false)
      expect(
        securityPolicySchema.safeParse({
          block: [{ provenance: 'DETERMINISTIC', severity: 'CRITICAL' }],
        }).success
      ).toBe(false)
    })
    it('accepts the documented shape', () => {
      expect(
        securityPolicySchema.safeParse({
          block: [
            { provenance: 'DETERMINISTIC', severity: 'HIGH' },
            { provenance: 'EXTERNAL_TOOL', severity: 'HIGH' },
          ],
        }).success
      ).toBe(true)
    })
  })

  describe('isBlockingUnderPolicy', () => {
    const external: SecurityPolicy = {
      block: [{ provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' }],
    }
    it('blocks an open finding whose pair is listed', () => {
      expect(isBlockingUnderPolicy(open({}), external)).toBe(true)
    })
    it('does not block the same finding under the default policy', () => {
      expect(isBlockingUnderPolicy(open({}), DEFAULT_SECURITY_POLICY)).toBe(
        false
      )
    })
    it('a dispositioned or persisting finding never blocks', () => {
      expect(
        isBlockingUnderPolicy(open({ disposition: 'FALSE_POSITIVE' }), external)
      ).toBe(false)
      expect(isBlockingUnderPolicy(open({ persisting: true }), external)).toBe(
        false
      )
    })
    it('an LLM_JUDGE finding never blocks even when a caller smuggles the pair in', () => {
      expect(
        isBlockingUnderPolicy(
          open({ provenance: 'LLM_JUDGE', severity: 'HIGH' }),
          { block: [{ provenance: 'LLM_JUDGE', severity: 'HIGH' } as never] }
        )
      ).toBe(false)
    })
  })

  describe('isBlockingFinding (gate)', () => {
    it('keeps the 732 behaviour with no policy argument', () => {
      expect(
        isBlockingFinding({
          provenance: 'DETERMINISTIC',
          severity: 'HIGH',
          disposition: null,
        })
      ).toBe(true)
      expect(isBlockingFinding(open({}))).toBe(false)
    })
    it('honours a passed policy', () => {
      expect(
        isBlockingFinding(open({}), {
          block: [{ provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' }],
        })
      ).toBe(true)
    })
  })

  describe('listOpenBlockingFindings', () => {
    const scan = (findings: object[]) => ({
      id: 's1',
      pullRequestId: 'pr1',
      workspaceId: 'w1',
      startedAt: new Date(1000),
      findings,
    })
    it('reads the workspace policy of the scan and blocks on a configured external MEDIUM', async () => {
      prs.mockResolvedValue([{ id: 'pr1' }])
      scans.mockResolvedValue([
        scan([open({ ruleId: 'ext:semgrep:x', filePath: 'a.ts' })]),
      ])
      policyOf.mockResolvedValue({
        block: [{ provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' }],
      })
      await expect(listOpenBlockingFindings('t1')).resolves.toEqual([
        { ruleId: 'ext:semgrep:x', filePath: 'a.ts' },
      ])
      expect(policyOf).toHaveBeenCalledWith('w1')
    })
    it('with a null policy only a DETERMINISTIC HIGH blocks', async () => {
      prs.mockResolvedValue([{ id: 'pr1' }])
      scans.mockResolvedValue([
        scan([
          open({ ruleId: 'ext:semgrep:x', filePath: 'a.ts' }),
          open({
            provenance: 'DETERMINISTIC',
            severity: 'HIGH',
            ruleId: 'secret:aws',
            filePath: 'b.ts',
          }),
        ]),
      ])
      policyOf.mockResolvedValue(null)
      await expect(listOpenBlockingFindings('t1')).resolves.toEqual([
        { ruleId: 'secret:aws', filePath: 'b.ts' },
      ])
    })
    it('does not read a policy when the task has no PR', async () => {
      prs.mockResolvedValue([])
      await expect(listOpenBlockingFindings('t1')).resolves.toEqual([])
      expect(policyOf).not.toHaveBeenCalled()
    })
  })
})
