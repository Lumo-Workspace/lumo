/**
 * @jest-environment node
 *
 * LUM-1117 — the on-demand project summary route writes the report in the
 * workspace's default language (`defaultLocale`), not the retired
 * summary-only language column (dropped in phase 2).
 */
import { NextRequest } from 'next/server'

const mockPending: Promise<unknown>[] = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockPending.push(p)
  },
}))
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'user_1' })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(async () => ({
    workspace: {
      id: 'ws1',
      name: 'Acme',
      defaultLocale: 'zh-CN',
    },
  })),
  loadProjectAndMember: jest.fn(async () => ({
    project: { id: 'p1', workspaceId: 'ws1' },
  })),
}))
jest.mock('@/lib/services/summary.service', () => ({
  summaryService: {
    requestGeneration: jest.fn(async () => ({ jobId: 'job1' })),
    createProjectSummary: jest.fn(async () => ({ id: 's2' })),
  },
}))
jest.mock('@/lib/services/stats.service', () => ({
  getProjectStats: jest.fn(async () => ({})),
}))
jest.mock('@/lib/summaries/report', () => ({
  generateProjectReport: jest.fn(async () => ({ tldr: 't', report: 'r' })),
}))
jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: { updateStatus: jest.fn(async () => undefined) },
}))
jest.mock('@/lib/repositories/stats.repository', () => ({
  statsRepository: {
    findWorkspaceDefaultLocale: jest.fn(async () => ({ defaultLocale: 'ja' })),
    findProjectNameAndDescription: jest.fn(async () => ({
      name: 'Web',
      description: null,
    })),
  },
}))

import { POST as postProject } from '@/app/api/summaries/generate/project/[projectId]/route'
import { generateProjectReport } from '@/lib/summaries/report'

beforeEach(() => {
  jest.clearAllMocks()
  mockPending.length = 0
})

it('the project report is written in the workspace defaultLocale', async () => {
  const res = await postProject(
    new NextRequest('http://localhost/api/summaries/generate/project/p1', {
      method: 'POST',
    }),
    { params: Promise.resolve({ projectId: 'p1' }) }
  )
  expect(res.status).toBe(202)
  await Promise.all(mockPending)
  expect(generateProjectReport).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ locale: 'ja' })
  )
})
