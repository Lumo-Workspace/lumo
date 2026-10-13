/**
 * @jest-environment node
 *
 * LUM-1117 — the on-demand summary routes write the report in the
 * workspace's default language (`defaultLocale`), not the retired
 * `summaryLocale` column.
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
      summaryLocale: 'en',
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
    createWorkspaceSummary: jest.fn(async () => ({ id: 's1' })),
    createProjectSummary: jest.fn(async () => ({ id: 's2' })),
  },
}))
jest.mock('@/lib/services/stats.service', () => ({
  getWorkspaceStats: jest.fn(async () => ({})),
  getProjectStats: jest.fn(async () => ({})),
}))
jest.mock('@/lib/summaries/report', () => ({
  generateWorkspaceReport: jest.fn(async () => ({ tldr: 't', report: 'r' })),
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

import { POST as postWorkspace } from '@/app/api/summaries/generate/workspace/route'
import { POST as postProject } from '@/app/api/summaries/generate/project/[projectId]/route'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'

beforeEach(() => {
  jest.clearAllMocks()
  mockPending.length = 0
})

it('the workspace report is written in defaultLocale', async () => {
  const res = await postWorkspace(
    new NextRequest('http://localhost/api/summaries/generate/workspace', {
      method: 'POST',
    })
  )
  expect(res.status).toBe(202)
  await Promise.all(mockPending)
  expect(generateWorkspaceReport).toHaveBeenCalledWith(expect.anything(), {
    workspaceName: 'Acme',
    locale: 'zh-CN',
  })
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
