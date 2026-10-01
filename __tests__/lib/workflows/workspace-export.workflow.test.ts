/**
 * @jest-environment node
 *
 * LUM-858 — the durable export run: build → keep for the TTL → delete, and a
 * failed build leaves no archive. The workflow body is tested with its steps
 * mocked; the expire/fail steps' service halves with the blob store mocked.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/workflows/workspace-export.steps', () => ({
  generateWorkspaceExportStep: jest.fn(),
  expireWorkspaceExportStep: jest.fn(),
  failWorkspaceExportStep: jest.fn(),
}))
jest.mock('@/lib/repositories/workspace-export.repository', () => ({
  ...jest.requireActual('@/lib/repositories/workspace-export.repository'),
  workspaceExportRepository: {
    findById: jest.fn(),
    markExpired: jest.fn(),
    markFailed: jest.fn(),
  },
}))
jest.mock('@/lib/services/workspace-export-blob', () => ({
  deleteExportArchive: jest.fn(),
}))

import { sleep } from 'workflow'
import { workspaceExportWorkflow } from '@/lib/workflows/workspace-export'
import {
  expireWorkspaceExportStep,
  failWorkspaceExportStep,
  generateWorkspaceExportStep,
} from '@/lib/workflows/workspace-export.steps'
import { workspaceExportService } from '@/lib/services/workspace-export.service'
import { workspaceExportRepository as repo } from '@/lib/repositories/workspace-export.repository'
import { deleteExportArchive } from '@/lib/services/workspace-export-blob'
import { EXPORT_TTL } from '@/lib/workspace/export-ttl'

const m = <T>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('workspaceExportWorkflow', () => {
  it('LUM-858 workflow: after generating it waits the 7 day window, then expires the export', async () => {
    const order: string[] = []
    m(generateWorkspaceExportStep).mockImplementation(async () => {
      order.push('generate')
    })
    m(sleep).mockImplementation(async (d: string) => {
      order.push(`sleep ${d}`)
    })
    m(expireWorkspaceExportStep).mockImplementation(async () => {
      order.push('expire')
    })

    const out = await workspaceExportWorkflow('exp1')

    expect(EXPORT_TTL).toBe('7d')
    expect(order).toEqual(['generate', 'sleep 7d', 'expire'])
    expect(expireWorkspaceExportStep).toHaveBeenCalledWith('exp1', undefined)
    expect(out).toEqual({ outcome: 'EXPIRED' })
    expect(failWorkspaceExportStep).not.toHaveBeenCalled()
  })

  it('LUM-858 workflow: a failed build is marked failed at once and never waits', async () => {
    m(generateWorkspaceExportStep).mockRejectedValue(new Error('db timeout'))

    const out = await workspaceExportWorkflow('exp1')

    expect(failWorkspaceExportStep).toHaveBeenCalledWith(
      'exp1',
      'db timeout',
      undefined
    )
    expect(sleep).not.toHaveBeenCalled()
    expect(expireWorkspaceExportStep).not.toHaveBeenCalled()
    expect(out).toEqual({ outcome: 'FAILED', reason: 'db timeout' })
  })
})

describe('LUM-923 export race: workflow input', () => {
  it('LUM-923 export race: every step receives the workspaceId the run was started with', async () => {
    m(generateWorkspaceExportStep).mockRejectedValue(new Error('gone'))
    await workspaceExportWorkflow('exp1', 'w1')
    expect(generateWorkspaceExportStep).toHaveBeenCalledWith('exp1', 'w1')
    expect(failWorkspaceExportStep).toHaveBeenCalledWith('exp1', 'gone', 'w1')

    jest.clearAllMocks()
    m(generateWorkspaceExportStep).mockResolvedValue(undefined)
    await workspaceExportWorkflow('exp1', 'w1')
    expect(expireWorkspaceExportStep).toHaveBeenCalledWith('exp1', 'w1')
  })
})

describe('expire / fail steps', () => {
  beforeEach(() => {
    m(repo.findById).mockResolvedValue({
      id: 'exp1',
      workspaceId: 'w1',
      status: 'READY',
    })
  })

  it('LUM-858 workflow: expiring deletes the archive blob and keeps the row as EXPIRED', async () => {
    await workspaceExportService.expireExport('exp1')

    expect(deleteExportArchive).toHaveBeenCalledWith('w1', 'exp1')
    expect(repo.markExpired).toHaveBeenCalledWith('exp1')
  })

  it('LUM-858 workflow: failing deletes any partial archive and marks the row FAILED', async () => {
    await workspaceExportService.failExport('exp1', 'x'.repeat(900))

    expect(deleteExportArchive).toHaveBeenCalledWith('w1', 'exp1')
    expect(repo.markFailed).toHaveBeenCalledWith('exp1', 'x'.repeat(500))
  })
})
