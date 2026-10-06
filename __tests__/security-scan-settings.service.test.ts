/**
 * @jest-environment node
 *
 * LUM-1002: the security-scan settings service — `{ all }` expands to every
 * switch, reads fill defaults + ceiling + effective layers, and writes go
 * through updateWorkspace with the caller's role from the member row.
 */
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSecuritySwitches: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn() },
}))
jest.mock('@/lib/services/workspace.service', () => ({
  workspaceService: { updateWorkspace: jest.fn() },
}))

import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { workspaceService } from '@/lib/services/workspace.service'
import {
  securityScanSettingsService,
  switchesForUpdate,
} from '@/lib/services/security-scan-settings.service'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const CALLER = { workspaceId: 'ws_1', workspaceSlug: 'acme', memberId: 'm_1' }

beforeEach(() => {
  jest.resetAllMocks()
  delete process.env.LUMO_MANAGED_SCAN
  delete process.env.LUMO_SECURITY_HUNT
})

describe('switchesForUpdate', () => {
  it('expands { all } to all three switches', () => {
    expect(switchesForUpdate({ all: false })).toEqual({
      securityScanEnabled: false,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
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
  it('returns switches, platform ceiling and effective layers', async () => {
    m(workspaceRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: false,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
    const s = await securityScanSettingsService.get('ws_1')
    expect(s.switches.securityScanEnabled).toBe(false)
    expect(s.effective.scan).toBe(false)
    expect(s.effective.aiReview).toBe(false)
    expect(s.platform).toHaveProperty('hunt')
  })
  it('404s on a missing workspace', async () => {
    m(workspaceRepository.findSecuritySwitches).mockResolvedValue(null)
    await expect(securityScanSettingsService.get('ws_x')).rejects.toMatchObject(
      { status: 404 }
    )
  })
})

describe('securityScanSettingsService.update', () => {
  it('writes every switch off via updateWorkspace with the member role', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
    m(workspaceRepository.findSecuritySwitches).mockResolvedValue({
      securityScanEnabled: false,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
    const s = await securityScanSettingsService.update(CALLER, { all: false })
    expect(workspaceService.updateWorkspace).toHaveBeenCalledWith(
      'ws_1',
      'OWNER',
      'acme',
      {
        securityScanEnabled: false,
        securityAiReviewEnabled: false,
        securityHuntEnabled: false,
      },
      undefined
    )
    expect(s.effective.scan).toBe(false)
  })
  it('propagates the 403 for a non-OWNER', async () => {
    m(miscRepository.findMemberRoleById).mockResolvedValue('MEMBER')
    m(workspaceService.updateWorkspace).mockRejectedValue(
      Object.assign(new Error('Only admins can update workspace settings'), {
        status: 403,
      })
    )
    await expect(
      securityScanSettingsService.update(CALLER, { all: false })
    ).rejects.toMatchObject({ status: 403 })
    expect(m(workspaceService.updateWorkspace).mock.calls[0][1]).toBe('MEMBER')
  })
})
