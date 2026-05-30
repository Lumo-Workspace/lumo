/**
 * @jest-environment node
 *
 * Auth (401) + not-found (404) coverage for the LUM-122 tier-2 retrieval API
 * routes: slack snapshot, web-link body, figma-link context, and pull request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))

jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
  taskSlackContextRepository: {
    getById: jest.fn(),
  },
  pullRequestRepository: {
    findByTaskAndNumber: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/task-figma-link.repository', () => ({
  taskFigmaLinkRepository: {
    findById: jest.fn(),
  },
}))

jest.mock('@/lib/services/task-web-link.service', () => ({
  taskWebLinkService: {
    fetchBody: jest.fn(),
  },
}))

import { taskRepository } from '@/lib/repositories'
import { GET as slackSnapshotGet } from '@/app/api/tasks/[id]/slack-contexts/[contextId]/snapshot/route'
import { GET as webBodyGet } from '@/app/api/tasks/[id]/web-links/[linkId]/body/route'
import { GET as figmaContextGet } from '@/app/api/tasks/[id]/figma-links/[linkId]/context/route'
import { GET as prGet } from '@/app/api/tasks/[id]/pull-requests/[number]/route'

const mockedRequireIdentity = requireIdentity as jest.Mock
const mockedFindByWorkspaceIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock

function req(): NextRequest {
  return new NextRequest('http://localhost/api/tasks/LUM-1/x')
}

function unauthorized() {
  mockedRequireIdentity.mockResolvedValue(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  )
}

function authed() {
  mockedRequireIdentity.mockResolvedValue({ workspaceId: 'ws_1' })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('retrieval routes — 401 without auth', () => {
  beforeEach(unauthorized)

  it('slack snapshot route returns 401', async () => {
    const res = await slackSnapshotGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', contextId: 'c' }),
    })
    expect(res.status).toBe(401)
  })

  it('web body route returns 401', async () => {
    const res = await webBodyGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', linkId: 'l' }),
    })
    expect(res.status).toBe(401)
  })

  it('figma context route returns 401', async () => {
    const res = await figmaContextGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', linkId: 'l' }),
    })
    expect(res.status).toBe(401)
  })

  it('pull request route returns 401', async () => {
    const res = await prGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', number: '5' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('retrieval routes — 404 when task not found', () => {
  beforeEach(() => {
    authed()
    mockedFindByWorkspaceIdentifier.mockResolvedValue(null)
  })

  it('slack snapshot route returns 404', async () => {
    const res = await slackSnapshotGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', contextId: 'c' }),
    })
    expect(res.status).toBe(404)
  })

  it('web body route returns 404', async () => {
    const res = await webBodyGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', linkId: 'l' }),
    })
    expect(res.status).toBe(404)
  })

  it('figma context route returns 404', async () => {
    const res = await figmaContextGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', linkId: 'l' }),
    })
    expect(res.status).toBe(404)
  })

  it('pull request route returns 404', async () => {
    const res = await prGet(req(), {
      params: Promise.resolve({ id: 'LUM-1', number: '5' }),
    })
    expect(res.status).toBe(404)
  })
})
