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
  },
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
}

beforeEach(() => {
  m(securityColumnsRepository.findSecuritySwitches).mockReset()
  m(workspaceRepository.update).mockReset()
  m(miscRepository.findMemberRoleById).mockReset()
  m(workspaceService.updateWorkspace).mockClear()
  delete process.env.LUMO_MANAGED_SCAN
  delete process.env.LUMO_SECURITY_HUNT
})

describe('switchesForUpdate', () => {
  it('expands { all } to all three switches', () => {
    expect(switchesForUpdate({ all: false })).toEqual(ALL_OFF)
    expect(switchesForUpdate({ all: true })).toEqual({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
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
