/** @jest-environment node */
/**
 * LUM-1230: the task-scoped resource routes the CLI calls accept the 8-char
 * short ref `lumo task context` prints (or a unique prefix) as well as the
 * full cuid, resolved among that task's resources only; ambiguity is a 409
 * listing the candidates, a task outside the caller's workspace a 404.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
  taskSlackContextRepository: { getById: jest.fn() },
}))
jest.mock('@/lib/repositories/task-resource-ref.repository', () => ({
  taskResourceRefRepository: { listIds: jest.fn() },
}))
jest.mock('@/lib/services/task-artifact.service', () => ({
  taskArtifactService: {
    getById: jest.fn(),
    removeArtifact: jest.fn(),
    updateArtifact: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-web-link.service', () => ({
  taskWebLinkService: { fetchBody: jest.fn() },
}))
jest.mock('@/lib/repositories/task-figma-link.repository', () => ({
  taskFigmaLinkRepository: { findById: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository, taskSlackContextRepository } from '@/lib/repositories'
import { taskResourceRefRepository } from '@/lib/repositories/task-resource-ref.repository'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'
import { resolveTaskResourceRef } from '@/lib/services/task-resource-ref.service'
import * as artifactRoute from '@/app/api/tasks/[id]/artifacts/[artifactId]/route'
import * as webBodyRoute from '@/app/api/tasks/[id]/web-links/[linkId]/body/route'
import * as slackRoute from '@/app/api/tasks/[id]/slack-contexts/[contextId]/snapshot/route'
import * as figmaRoute from '@/app/api/tasks/[id]/figma-links/[linkId]/context/route'

const A = 'cmva568gc00l506jvpskvl3sh'
const B = 'cmva568fw00l106jv6z9j2q6d'
const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const listIds = taskResourceRefRepository.listIds as jest.Mock
const req = (method = 'GET') =>
  new NextRequest('http://x/api/tasks/LUM-1/x', { method })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 'task-1',
  })
  listIds.mockResolvedValue([A, B])
})

describe('resolveTaskResourceRef', () => {
  it('resolves the short ref, a unique prefix and the full id', async () => {
    await expect(
      resolveTaskResourceRef('artifact', 'task-1', 'pskvl3sh')
    ).resolves.toBe(A)
    await expect(
      resolveTaskResourceRef('artifact', 'task-1', 'cmva568fw')
    ).resolves.toBe(B)
    await expect(resolveTaskResourceRef('artifact', 'task-1', A)).resolves.toBe(
      A
    )
    expect(listIds).toHaveBeenCalledWith('artifact', 'task-1')
  })

  it('409 listing both candidates for a shared prefix', async () => {
    const err = (await resolveTaskResourceRef(
      'webLink',
      'task-1',
      'cmva568'
    ).catch((e: unknown) => e)) as Error & { status: number }
    expect(err.status).toBe(409)
    expect(err.message).toContain(A)
    expect(err.message).toContain(B)
    expect(err.message).toContain('web link')
  })

  it('400 for a short ref under 6 characters, without a query', async () => {
    await expect(
      resolveTaskResourceRef('figmaLink', 'task-1', 'pskv')
    ).rejects.toMatchObject({ status: 400 })
    expect(listIds).not.toHaveBeenCalled()
  })

  it('404 when nothing on the task matches', async () => {
    await expect(
      resolveTaskResourceRef('slackContext', 'task-1', 'zzzzzzzz')
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('routes resolve the ref within the task', () => {
  it('artifact GET / PATCH / DELETE use the resolved id', async () => {
    ;(taskArtifactService.getById as jest.Mock).mockResolvedValue({ id: A })
    const p = {
      params: Promise.resolve({ id: 'LUM-1', artifactId: 'pskvl3sh' }),
    }
    expect((await artifactRoute.GET(req(), p)).status).toBe(200)
    expect(taskArtifactService.getById).toHaveBeenCalledWith('task-1', A)

    const del = {
      params: Promise.resolve({ id: 'LUM-1', artifactId: 'pskvl3sh' }),
    }
    await artifactRoute.DELETE(req('DELETE'), del)
    expect(taskArtifactService.removeArtifact).toHaveBeenCalledWith('task-1', A)
  })

  it('web link body uses the resolved id', async () => {
    ;(taskWebLinkService.fetchBody as jest.Mock).mockResolvedValue({
      body: 'x',
    })
    const p = { params: Promise.resolve({ id: 'LUM-1', linkId: '6z9j2q6d' }) }
    await webBodyRoute.GET(req(), p)
    expect((taskWebLinkService.fetchBody as jest.Mock).mock.calls[0]).toContain(
      B
    )
  })

  it('Slack snapshot uses the resolved id', async () => {
    ;(taskSlackContextRepository.getById as jest.Mock).mockResolvedValue(null)
    const p = {
      params: Promise.resolve({ id: 'LUM-1', contextId: 'pskvl3sh' }),
    }
    await slackRoute.GET(req(), p)
    expect(taskSlackContextRepository.getById).toHaveBeenCalledWith(A)
  })

  it('Figma context uses the resolved id', async () => {
    ;(taskFigmaLinkRepository.findById as jest.Mock).mockResolvedValue(null)
    const p = { params: Promise.resolve({ id: 'LUM-1', linkId: 'pskvl3sh' }) }
    await figmaRoute.GET(req(), p)
    expect(taskFigmaLinkRepository.findById).toHaveBeenCalledWith(A)
  })

  it('an ambiguous ref is a 409 and reaches no handler', async () => {
    const p = {
      params: Promise.resolve({ id: 'LUM-1', artifactId: 'cmva568' }),
    }
    const res = await artifactRoute.GET(req(), p)
    expect(res.status).toBe(409)
    expect(taskArtifactService.getById).not.toHaveBeenCalled()
  })

  it.each([
    [
      'artifact',
      () =>
        artifactRoute.GET(req(), {
          params: Promise.resolve({ id: 'LUM-9', artifactId: 'pskvl3sh' }),
        }),
    ],
    [
      'web link',
      () =>
        webBodyRoute.GET(req(), {
          params: Promise.resolve({ id: 'LUM-9', linkId: 'pskvl3sh' }),
        }),
    ],
    [
      'Slack',
      () =>
        slackRoute.GET(req(), {
          params: Promise.resolve({ id: 'LUM-9', contextId: 'pskvl3sh' }),
        }),
    ],
    [
      'Figma',
      () =>
        figmaRoute.GET(req(), {
          params: Promise.resolve({ id: 'LUM-9', linkId: 'pskvl3sh' }),
        }),
    ],
  ])(
    '%s: a task from another workspace is a 404 before any ref lookup',
    async (_name, call) => {
      ;(
        taskRepository.findByWorkspaceIdentifier as jest.Mock
      ).mockResolvedValue(null)
      const res = await call()
      expect(res.status).toBe(404)
      expect(listIds).not.toHaveBeenCalled()
    }
  )
})
