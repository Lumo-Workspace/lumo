/**
 * @jest-environment node
 */

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))

jest.mock('@/lib/api/helpers', () => ({
  requireTaskMember: jest.fn(),
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForMemoryContext: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegration: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findRepositories: jest.fn(),
  },
}))

jest.mock('@/lib/services/lumo-sync/github-tree.service', () => ({
  githubTreeService: {
    readFile: jest.fn(),
  },
}))

jest.mock('@/lib/services/lumo-proposal/lumo-proposal.service', () => ({
  lumoProposalService: {
    generateProposal: jest.fn(),
  },
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: jest.fn((v: string) => `decrypted:${v}`),
}))

import { POST } from '@/app/api/tasks/[id]/lumo-proposals/route'
import { requireAuth } from '@/lib/auth'
import { requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { githubTreeService } from '@/lib/services/lumo-sync/github-tree.service'
import { lumoProposalService } from '@/lib/services/lumo-proposal/lumo-proposal.service'
import { NextResponse } from 'next/server'

function makeParams(taskId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: taskId }) }
}

const TASK = {
  id: 'task-1',
  title: 'Fix auth bug',
  description: 'SSO broken',
  projectId: 'proj-1',
  number: 42,
  project: { workspaceId: 'ws-1' },
  team: { identifier: 'LUM' },
}

const MEMBER = { id: 'mem-1', role: 'MEMBER' }

const INTEGRATION = { accessToken: 'enc-token' }

const REPOS = [{ id: 'repo-1', fullName: 'acme/myrepo', isDefault: true }]

const PROPOSAL = {
  id: 'prop-1',
  operations: [
    {
      type: 'add',
      section: 'Traps',
      content: 'SSO needs HTTPS',
      rationale: 'r',
      sourceTaskId: 'LUM-42',
    },
  ],
  summary: 'Added SSO trap',
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/tasks/[id]/lumo-proposals', () => {
  it('returns 401 when not authenticated', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    )

    const res = await POST(
      new Request('http://x/api/tasks/task-1/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('task-1')
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when task not found', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(taskRepository.findForMemoryContext as jest.Mock).mockResolvedValue(null)
    ;(requireTaskMember as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Task not found' }, { status: 404 })
    )

    const res = await POST(
      new Request('http://x/api/tasks/missing/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('missing')
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when GitHub is not connected', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(taskRepository.findForMemoryContext as jest.Mock).mockResolvedValue(TASK)
    ;(requireTaskMember as jest.Mock).mockResolvedValue({
      task: TASK,
      member: MEMBER,
    })
    ;(githubRepository.findIntegration as jest.Mock).mockResolvedValue(null)

    const res = await POST(
      new Request('http://x/api/tasks/task-1/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('task-1')
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/GitHub not connected/i)
  })

  it('returns 400 when no repository is linked to the project', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(taskRepository.findForMemoryContext as jest.Mock).mockResolvedValue(TASK)
    ;(requireTaskMember as jest.Mock).mockResolvedValue({
      task: TASK,
      member: MEMBER,
    })
    ;(githubRepository.findIntegration as jest.Mock).mockResolvedValue(
      INTEGRATION
    )
    ;(projectRepository.findRepositories as jest.Mock).mockResolvedValue([])

    const res = await POST(
      new Request('http://x/api/tasks/task-1/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('task-1')
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/No repository/i)
  })

  it('returns proposal preview on success', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(taskRepository.findForMemoryContext as jest.Mock).mockResolvedValue(TASK)
    ;(requireTaskMember as jest.Mock).mockResolvedValue({
      task: TASK,
      member: MEMBER,
    })
    ;(githubRepository.findIntegration as jest.Mock).mockResolvedValue(
      INTEGRATION
    )
    ;(projectRepository.findRepositories as jest.Mock).mockResolvedValue(REPOS)
    ;(githubTreeService.readFile as jest.Mock).mockResolvedValue('# LUMO.md\n')
    ;(lumoProposalService.generateProposal as jest.Mock).mockResolvedValue(
      PROPOSAL
    )

    const res = await POST(
      new Request('http://x/api/tasks/task-1/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('task-1')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(PROPOSAL)
    expect(githubTreeService.readFile).toHaveBeenCalledWith(
      'acme',
      'myrepo',
      'LUMO.md',
      'decrypted:enc-token'
    )
    expect(lumoProposalService.generateProposal).toHaveBeenCalledWith(
      'task-1',
      '# LUMO.md\n'
    )
  })

  it('falls back to first repo when none is marked default', async () => {
    const reposNoDefault = [
      { id: 'repo-1', fullName: 'acme/fallback', isDefault: false },
    ]
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(taskRepository.findForMemoryContext as jest.Mock).mockResolvedValue(TASK)
    ;(requireTaskMember as jest.Mock).mockResolvedValue({
      task: TASK,
      member: MEMBER,
    })
    ;(githubRepository.findIntegration as jest.Mock).mockResolvedValue(
      INTEGRATION
    )
    ;(projectRepository.findRepositories as jest.Mock).mockResolvedValue(
      reposNoDefault
    )
    ;(githubTreeService.readFile as jest.Mock).mockResolvedValue(null)
    ;(lumoProposalService.generateProposal as jest.Mock).mockResolvedValue(
      PROPOSAL
    )

    const res = await POST(
      new Request('http://x/api/tasks/task-1/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('task-1')
    )
    expect(res.status).toBe(200)
    expect(githubTreeService.readFile).toHaveBeenCalledWith(
      'acme',
      'fallback',
      'LUMO.md',
      'decrypted:enc-token'
    )
    // LUMO.md not found → empty string passed to service
    expect(lumoProposalService.generateProposal).toHaveBeenCalledWith(
      'task-1',
      ''
    )
  })

  it('forwards service error status codes', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(taskRepository.findForMemoryContext as jest.Mock).mockResolvedValue(TASK)
    ;(requireTaskMember as jest.Mock).mockResolvedValue({
      task: TASK,
      member: MEMBER,
    })
    ;(githubRepository.findIntegration as jest.Mock).mockResolvedValue(
      INTEGRATION
    )
    ;(projectRepository.findRepositories as jest.Mock).mockResolvedValue(REPOS)
    ;(githubTreeService.readFile as jest.Mock).mockResolvedValue('# LUMO.md\n')
    ;(lumoProposalService.generateProposal as jest.Mock).mockRejectedValue(
      Object.assign(new Error('No memories found for task'), { status: 400 })
    )

    const res = await POST(
      new Request('http://x/api/tasks/task-1/lumo-proposals', {
        method: 'POST',
      }),
      makeParams('task-1')
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('No memories found for task')
  })
})
