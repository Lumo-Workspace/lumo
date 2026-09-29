/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findScanRepository: jest.fn(),
    scrubCodeForScan: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))

import { logger } from '@/lib/logger'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { scrubScanIfRepositoryUnconfirmed } from '@/lib/services/scan-code-retention.service'

const findScan = prSecurityScanRepository.findScanRepository as jest.Mock
const scrub = prSecurityScanRepository.scrubCodeForScan as jest.Mock
const findInstallation =
  githubAppInstallationRepository.findByWorkspace as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  findScan.mockResolvedValue({ workspaceId: 'w1', repo: 'acme/payroll' })
  findInstallation.mockResolvedValue({
    id: 'i1',
    workspaceId: 'w1',
    installationId: 1,
    repositories: ['acme/api'],
  })
  scrub.mockResolvedValue({ scans: 1, findings: 2 })
})

describe('LUM-896 scrubScanIfRepositoryUnconfirmed', () => {
  it('scrubs a scan whose repository left the list', async () => {
    await expect(scrubScanIfRepositoryUnconfirmed('s1')).resolves.toBe(true)
    expect(scrub).toHaveBeenCalledWith('s1')
  })

  it('leaves a scan of a confirmed repository alone, whatever its case', async () => {
    findScan.mockResolvedValue({ workspaceId: 'w1', repo: 'ACME/Api' })
    await expect(scrubScanIfRepositoryUnconfirmed('s1')).resolves.toBe(false)
    expect(scrub).not.toHaveBeenCalled()
  })

  it('LUM-896 recheck failure is logged, not thrown', async () => {
    scrub.mockRejectedValue(new Error('db down'))
    await expect(scrubScanIfRepositoryUnconfirmed('s1')).resolves.toBe(false)
    findInstallation.mockRejectedValue(new Error('pool exhausted'))
    await expect(scrubScanIfRepositoryUnconfirmed('s2')).resolves.toBe(false)
    const lines = (logger.error as jest.Mock).mock.calls.map(c => String(c[0]))
    expect(lines).toEqual([
      expect.stringContaining('scan s1: confirmed-list recheck failed'),
      expect.stringContaining('scan s2: confirmed-list recheck failed'),
    ])
    expect(lines[0]).toContain('db down')
    expect(lines[1]).toContain('pool exhausted')
  })
})
