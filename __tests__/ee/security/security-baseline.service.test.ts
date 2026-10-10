/** @jest-environment node */
// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchDefaultBranchHead: jest.fn(),
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findSecurityBaseline: jest.fn(),
    setSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-baseline-scan-start', () => ({
  startSecurityBaselineScan: jest.fn(),
}))

import { logger } from '@/lib/logger'
import { fetchDefaultBranchHead } from '@/lib/integrations/github/contents'
import { projectRepository } from '@/lib/repositories/project.repository'
import { startSecurityBaselineScan } from '@/lib/services/security-baseline-scan-start'
import {
  securityBaselineService,
  isBaselineLive,
} from '@/lib/services/security-baseline.service'
import { BASELINE_STALE_MS } from '@/lib/services/security-managed-scan.config'

const find = projectRepository.findSecurityBaseline as jest.Mock
const set = projectRepository.setSecurityBaseline as jest.Mock
const head = fetchDefaultBranchHead as jest.Mock
const startBaseline = startSecurityBaselineScan as jest.Mock

const NOW = new Date('2026-09-10T12:00:00.000Z')
const SHA = 'b'.repeat(40)
const JOB = { workspaceId: 'w1', repo: 'o/r', sha: SHA }
const landed = {
  sha: 'a'.repeat(40),
  at: '2026-09-09T00:00:00.000Z',
  requestedAt: '2026-09-09T00:00:00.000Z',
  fingerprints: ['x'],
  partial: false,
  tools: ['semgrep'],
}
const claim = (requestedAt: string) => ({
  sha: SHA,
  at: null,
  requestedAt,
  fingerprints: [],
  partial: false,
  tools: [],
})
const CLAIM_ROW = {
  sha: SHA,
  at: null,
  requestedAt: NOW.toISOString(),
  fingerprints: [],
  partial: false,
  tools: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_MANAGED_SCAN
  set.mockResolvedValue(1)
  startBaseline.mockResolvedValue('run_b')
})

describe('LUM-738 baseline lifecycle — service', () => {
  it('isBaselineLive: landed → present; young claim → in_flight; stale claim / none → null', () => {
    expect(isBaselineLive(landed, NOW)).toBe('present')
    expect(
      isBaselineLive(claim(new Date(NOW.getTime() - 1000).toISOString()), NOW)
    ).toBe('in_flight')
    expect(
      isBaselineLive(
        claim(new Date(NOW.getTime() - BASELINE_STALE_MS - 1).toISOString()),
        NOW
      )
    ).toBeNull()
    expect(isBaselineLive(claim('garbage'), NOW)).toBeNull()
    expect(isBaselineLive(null, NOW)).toBeNull()
    expect(isBaselineLive(undefined, NOW)).toBeNull()
  })

  describe('requestFromPush', () => {
    it('claims (at: null, requestedAt: now, sha) then starts the workflow, replacing a landed baseline', async () => {
      find.mockResolvedValue(landed)
      await expect(
        securityBaselineService.requestFromPush(JOB, NOW)
      ).resolves.toBe('requested')
      expect(set).toHaveBeenCalledWith('w1', 'o/r', CLAIM_ROW)
      expect(startBaseline).toHaveBeenCalledWith(JOB)
      // Claim before start: a start that races the write must find the claim.
      expect(set.mock.invocationCallOrder[0]!).toBeLessThan(
        startBaseline.mock.invocationCallOrder[0]!
      )
    })

    it('is a no-op when the managed scan is off or the repo is not linked', async () => {
      process.env.LUMO_MANAGED_SCAN = 'off'
      await expect(
        securityBaselineService.requestFromPush(JOB, NOW)
      ).resolves.toBe('disabled')
      delete process.env.LUMO_MANAGED_SCAN
      find.mockResolvedValue(undefined)
      await expect(
        securityBaselineService.requestFromPush(JOB, NOW)
      ).resolves.toBe('unlinked')
      expect(set).not.toHaveBeenCalled()
      expect(startBaseline).not.toHaveBeenCalled()
    })

    it('does not pile a second run onto a young in-flight claim, but supersedes a stale one', async () => {
      find.mockResolvedValue(
        claim(new Date(NOW.getTime() - 60_000).toISOString())
      )
      await expect(
        securityBaselineService.requestFromPush(JOB, NOW)
      ).resolves.toBe('in_flight')
      expect(startBaseline).not.toHaveBeenCalled()
      find.mockResolvedValue(
        claim(new Date(NOW.getTime() - BASELINE_STALE_MS - 1).toISOString())
      )
      await expect(
        securityBaselineService.requestFromPush(JOB, NOW)
      ).resolves.toBe('requested')
    })

    it('reports start_failed (claim written) when the workflow could not be queued', async () => {
      find.mockResolvedValue(null)
      startBaseline.mockResolvedValue(null)
      await expect(
        securityBaselineService.requestFromPush(JOB, NOW)
      ).resolves.toBe('start_failed')
      expect(set).toHaveBeenCalledTimes(1)
    })
  })

  describe('ensure (lazy build from a PR scan)', () => {
    it('with no baseline: resolves the default-branch head, claims it and starts', async () => {
      find.mockResolvedValue(null)
      head.mockResolvedValue({ branch: 'main', sha: SHA })
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('requested')
      expect(head).toHaveBeenCalledWith({ workspaceId: 'w1', fullName: 'o/r' })
      expect(set).toHaveBeenCalledWith('w1', 'o/r', CLAIM_ROW)
      expect(startBaseline).toHaveBeenCalledWith(JOB)
    })

    it('does nothing when a baseline is present or a claim is in flight', async () => {
      find.mockResolvedValue(landed)
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('present')
      find.mockResolvedValue(claim(NOW.toISOString()))
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('in_flight')
      expect(head).not.toHaveBeenCalled()
      expect(startBaseline).not.toHaveBeenCalled()
    })

    it('never throws: a GitHub or DB failure is logged and reported as start_failed', async () => {
      find.mockResolvedValue(null)
      head.mockRejectedValue(new Error('GitHub API error 404 for repo o/r'))
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('start_failed')
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('404'))
      find.mockRejectedValue(new Error('P1001'))
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('start_failed')
    })

    it('respects the kill switch and an unlinked repo', async () => {
      process.env.LUMO_MANAGED_SCAN = 'off'
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('disabled')
      delete process.env.LUMO_MANAGED_SCAN
      find.mockResolvedValue(undefined)
      await expect(
        securityBaselineService.ensure({ workspaceId: 'w1', repo: 'o/r' }, NOW)
      ).resolves.toBe('unlinked')
    })
  })

  describe('persist', () => {
    const outcome = {
      fingerprints: ['f1', 'f2'],
      partial: true,
      tools: ['gitleaks', 'osv-scanner'],
      failed: ['semgrep exit 2'],
      skipped: [],
    }

    it('writes {sha, at: now, requestedAt (carried from the claim of the same sha), fingerprints, partial, tools}', async () => {
      find.mockResolvedValue(claim('2026-09-10T11:50:00.000Z'))
      await expect(
        securityBaselineService.persist(JOB, outcome, NOW)
      ).resolves.toBe(1)
      expect(set).toHaveBeenCalledWith('w1', 'o/r', {
        sha: SHA,
        at: NOW.toISOString(),
        requestedAt: '2026-09-10T11:50:00.000Z',
        fingerprints: ['f1', 'f2'],
        partial: true,
        tools: ['gitleaks', 'osv-scanner'],
      })
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('2 fingerprints')
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('failed=semgrep exit 2')
      )
    })

    it('stamps requestedAt = now when the claim is for another sha (or missing)', async () => {
      find.mockResolvedValue(landed)
      await securityBaselineService.persist(JOB, outcome, NOW)
      expect(set).toHaveBeenCalledWith(
        'w1',
        'o/r',
        expect.objectContaining({ requestedAt: NOW.toISOString() })
      )
    })

    it('propagates a write failure so the step retries', async () => {
      find.mockResolvedValue(null)
      set.mockRejectedValue(new Error('P1001'))
      await expect(
        securityBaselineService.persist(JOB, outcome, NOW)
      ).rejects.toThrow('P1001')
    })
  })
})
