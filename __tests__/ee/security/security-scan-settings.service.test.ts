/**
 * @jest-environment node
 *
 * LUM-1002: the security-scan settings service — `{ all }` expands to every
 * switch, reads fill defaults + ceiling + effective layers + `canEdit`, and
 * writes go through the real `updateWorkspace` OWNER gate with the caller's
 * role from the member row.
 */
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { update: jest.fn() },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecuritySwitches: jest.fn(),
    findSecurityPolicy: jest.fn(async () => null),
    replaceSecurityPolicyIf: jest.fn(async () => true),
  },
}))

// LUM-1329: the agent-review write records its own audit event.
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: jest.fn(async () => true),
}))

jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn() },
}))
// The real service by default, so the OWNER gate under test is the shipped
// one; the OWNER write path stubs it to stay off the audit/DB internals.
jest.mock('@/lib/services/workspace.service', () => {
  const actual = jest.requireActual('@/lib/services/workspace.service')
  return {
    workspaceService: {
      updateWorkspace: jest.fn((...args: unknown[]) =>
        actual.workspaceService.updateWorkspace(...args)
      ),
    },
  }
})

import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { workspaceService } from '@/lib/services/workspace.service'
import { recordAuditEvent } from '@/lib/services/audit.service'
import {
  securityScanSettingsService,
  switchesForUpdate,
} from '@/ee/security/services/security-scan-settings.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const CALLER = { workspaceId: 'ws_1', workspaceSlug: 'acme', memberId: 'm_1' }
const ALL_OFF = {
  securityScanEnabled: false,
  securityAiReviewEnabled: false,
  securityHuntEnabled: false,
  securityRewardHackEnabled: false,
}

beforeEach(() => {
  m(securityColumnsRepository.findSecuritySwitches).mockReset()
  m(securityColumnsRepository.findSecurityPolicy).mockReset()
  m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue(null)
  m(securityColumnsRepository.replaceSecurityPolicyIf).mockReset()
  m(securityColumnsRepository.replaceSecurityPolicyIf).mockResolvedValue(true)
  m(recordAuditEvent).mockClear()
  m(workspaceRepository.update).mockReset()
  m(miscRepository.findMemberRoleById).mockReset()
  m(workspaceService.updateWorkspace).mockClear()
  delete process.env.LUMO_MANAGED_SCAN
  delete process.env.LUMO_SECURITY_HUNT
})

describe('switchesForUpdate', () => {
  it('expands { all } to every layer switch', () => {
    expect(switchesForUpdate({ all: false })).toEqual(ALL_OFF)
    expect(switchesForUpdate({ all: true })).toEqual({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
      securityRewardHackEnabled: true,
    })
  })
  it('LUM-1234 passes the reward-hack switch through, alone', () => {
    expect(switchesForUpdate({ securityRewardHackEnabled: false })).toEqual({
      securityRewardHackEnabled: false,
    })
  })
  it('passes single switches through', () => {
    expect(switchesForUpdate({ securityHuntEnabled: false })).toEqual({
      securityHuntEnabled: false,
    })
  })
})

describe('securityScanSettingsService.get', () => {
  it('returns switches, ceiling, effective layers and canEdit for an OWNER', async () => {
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: false,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
    m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
    const s = await securityScanSettingsService.get(CALLER)
    expect(s.switches.securityScanEnabled).toBe(false)
    expect(s.effective.scan).toBe(false)
    expect(s.effective.aiReview).toBe(false)
    expect(s.platform).toHaveProperty('hunt')
    expect(s.canEdit).toBe(true)
  })
  it('canEdit is false for a MEMBER', async () => {
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue(ALL_OFF)
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    expect((await securityScanSettingsService.get(CALLER)).canEdit).toBe(false)
  })
  it('404s on a missing workspace', async () => {
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue(null)
    await expect(securityScanSettingsService.get(CALLER)).rejects.toMatchObject(
      { status: 404 }
    )
  })
})

describe('securityScanSettingsService.update', () => {
  it('writes every switch off via updateWorkspace with the member role', async () => {
    m(workspaceService.updateWorkspace).mockResolvedValueOnce({})
    m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue(ALL_OFF)
    const s = await securityScanSettingsService.update(CALLER, { all: false })
    expect(workspaceService.updateWorkspace).toHaveBeenCalledWith(
      'ws_1',
      'OWNER',
      'acme',
      ALL_OFF,
      undefined
    )
    expect(s.effective.scan).toBe(false)
  })
  it('a MEMBER is refused by the real OWNER gate and nothing is written', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      securityScanSettingsService.update(CALLER, { all: false })
    ).rejects.toMatchObject({
      status: 403,
      message: 'Only admins can update workspace settings',
    })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
  })
  it('a member row that no longer exists is refused the same way', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue(null)
    await expect(
      securityScanSettingsService.update(CALLER, { all: true })
    ).rejects.toMatchObject({ status: 403 })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
  })
})

describe('LUM-1130 request-changes workflow setting', () => {
  it('passes the switch through and `all` never touches it', () => {
    expect(
      switchesForUpdate({ securityRequestChangesEnabled: true })
    ).toMatchObject({ securityRequestChangesEnabled: true })
    expect(switchesForUpdate({ all: true })).not.toHaveProperty(
      'securityRequestChangesEnabled'
    )
  })
  it('reads off by default and as stored', async () => {
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
    m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityRequestChangesEnabled
    ).toBe(false)
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
      securityRequestChangesEnabled: true,
    })
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityRequestChangesEnabled
    ).toBe(true)
  })
})

describe('LUM-1142 author approval setting', () => {
  it('passes the switch through and `all` never touches it', () => {
    expect(
      switchesForUpdate({ securityAllowAuthorApproval: false })
    ).toMatchObject({ securityAllowAuthorApproval: false })
    expect(switchesForUpdate({ all: false })).not.toHaveProperty(
      'securityAllowAuthorApproval'
    )
  })
  it('reads ON by default and as stored', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue(ALL_OFF)
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityAllowAuthorApproval
    ).toBe(true)
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      ...ALL_OFF,
      securityAllowAuthorApproval: false,
    })
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityAllowAuthorApproval
    ).toBe(false)
  })
  it('a MEMBER cannot change it (403, nothing written)', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      securityScanSettingsService.update(CALLER, {
        securityAllowAuthorApproval: false,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
  })
})

describe('LUM-1134 learnings scope setting', () => {
  it('passes the scope through and `all` never touches it', () => {
    expect(
      switchesForUpdate({ securityLearningsScope: 'local' })
    ).toMatchObject({ securityLearningsScope: 'local' })
    expect(switchesForUpdate({ all: false })).not.toHaveProperty(
      'securityLearningsScope'
    )
  })
  it('reads auto by default and as stored', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityLearningsScope
    ).toBe('auto')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
      securityLearningsScope: 'global',
    })
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityLearningsScope
    ).toBe('global')
  })
  it('a MEMBER cannot change it (403 from the shipped OWNER gate)', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      securityScanSettingsService.update(CALLER, {
        securityLearningsScope: 'global',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
  })
})

describe('LUM-1137 review pause-after setting', () => {
  it('passes the value through and `all` never touches it', () => {
    expect(
      switchesForUpdate({ securityReviewAutoPauseAfter: 0 })
    ).toMatchObject({ securityReviewAutoPauseAfter: 0 })
    expect(switchesForUpdate({ all: true })).not.toHaveProperty(
      'securityReviewAutoPauseAfter'
    )
  })
  it('reads 5 by default', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
    expect(
      (await securityScanSettingsService.get(CALLER)).switches
        .securityReviewAutoPauseAfter
    ).toBe(5)
  })
  it('a MEMBER cannot change it (403 from the shipped OWNER gate)', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      securityScanSettingsService.update(CALLER, {
        securityReviewAutoPauseAfter: 0,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
  })
})

describe('LUM-1329 agent-review blocking', () => {
  const OWN_POLICY = {
    block: [
      { provenance: 'DETERMINISTIC', severity: 'HIGH' },
      { provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' },
      { provenance: 'AGENT_REVIEW', severity: 'LOW' },
    ],
  }
  const asOwner = () => {
    m(workspaceService.updateWorkspace).mockResolvedValue({})
    m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue(ALL_OFF)
  }
  // Back to the shipped OWNER gate for the next test.
  afterEach(() =>
    m(workspaceService.updateWorkspace).mockImplementation(
      (...args: unknown[]) =>
        jest
          .requireActual('@/lib/services/workspace.service')
          .workspaceService.updateWorkspace(...args)
    )
  )

  it('reads off by default, and the stored level', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    m(securityColumnsRepository.findSecuritySwitches).mockResolvedValue(ALL_OFF)
    expect(
      (await securityScanSettingsService.get(CALLER)).agentReviewBlocking
    ).toBe('off')
    m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue({
      block: [
        { provenance: 'DETERMINISTIC', severity: 'HIGH' },
        { provenance: 'AGENT_REVIEW', severity: 'MEDIUM' },
        { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
      ],
    })
    expect(
      (await securityScanSettingsService.get(CALLER)).agentReviewBlocking
    ).toBe('medium')
    m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue(
      OWN_POLICY
    )
    expect(
      (await securityScanSettingsService.get(CALLER)).agentReviewBlocking
    ).toBe('custom')
  })

  it('an OWNER write compare-and-sets only the AGENT_REVIEW entries, keeping every other one, and audits it', async () => {
    asOwner()
    m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue(
      OWN_POLICY
    )
    await securityScanSettingsService.update(
      CALLER,
      { agentReviewBlocking: 'high' },
      undefined
    )
    // The OWNER gate ran first, with no policy in the generic write.
    expect(
      m(workspaceService.updateWorkspace).mock.calls[0]![3]
    ).not.toHaveProperty('securityPolicy')
    const next = {
      block: [
        { provenance: 'DETERMINISTIC', severity: 'HIGH' },
        { provenance: 'EXTERNAL_TOOL', severity: 'MEDIUM' },
        { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
      ],
    }
    expect(
      securityColumnsRepository.replaceSecurityPolicyIf
    ).toHaveBeenCalledWith('ws_1', OWN_POLICY, next)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_1',
        action: 'workspace.agent_review_blocking_updated',
        metadata: {
          from: 'custom',
          to: 'high',
          changes: { securityPolicy: { from: OWN_POLICY, to: next } },
        },
      })
    )
  })

  it('a concurrent edit to the policy is re-read and kept, not overwritten', async () => {
    asOwner()
    const edited = {
      block: [
        { provenance: 'DETERMINISTIC', severity: 'HIGH' },
        { provenance: 'EXTERNAL_TOOL', severity: 'LOW' },
      ],
    }
    m(securityColumnsRepository.findSecurityPolicy)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(edited)
    m(securityColumnsRepository.replaceSecurityPolicyIf)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    await securityScanSettingsService.update(CALLER, {
      agentReviewBlocking: 'high',
    })
    const calls = m(securityColumnsRepository.replaceSecurityPolicyIf).mock
      .calls
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual([
      'ws_1',
      edited,
      {
        block: [
          ...edited.block,
          { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
        ],
      },
    ])
    expect(recordAuditEvent).toHaveBeenCalledTimes(1)
  })

  it('gives up with 409 when the policy keeps changing, writing nothing', async () => {
    asOwner()
    m(securityColumnsRepository.replaceSecurityPolicyIf).mockResolvedValue(
      false
    )
    await expect(
      securityScanSettingsService.update(CALLER, { agentReviewBlocking: 'low' })
    ).rejects.toMatchObject({ status: 409 })
    expect(
      securityColumnsRepository.replaceSecurityPolicyIf
    ).toHaveBeenCalledTimes(3)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('turning it off back to exactly the default writes null (follows the default again)', async () => {
    asOwner()
    const stored = {
      block: [
        { provenance: 'DETERMINISTIC', severity: 'HIGH' },
        { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
      ],
    }
    m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue(stored)
    await securityScanSettingsService.update(CALLER, {
      agentReviewBlocking: 'off',
    })
    expect(
      securityColumnsRepository.replaceSecurityPolicyIf
    ).toHaveBeenCalledWith('ws_1', stored, null)
  })

  it('the stored level, or no agent-review change, writes no policy and audits nothing extra', async () => {
    asOwner()
    await securityScanSettingsService.update(CALLER, {
      agentReviewBlocking: 'off',
    })
    await securityScanSettingsService.update(CALLER, {
      securityHuntEnabled: false,
    })
    expect(
      securityColumnsRepository.replaceSecurityPolicyIf
    ).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('a MEMBER is refused by the OWNER gate before any policy read or write', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    await expect(
      securityScanSettingsService.update(CALLER, {
        agentReviewBlocking: 'low',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
    expect(
      securityColumnsRepository.replaceSecurityPolicyIf
    ).not.toHaveBeenCalled()
  })
})
