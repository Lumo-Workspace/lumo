/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/worktree.repository', () => ({
  worktreeRepository: {
    upsertWorktree: jest.fn(),
    markRemoved: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    linkToWorktreeByCwd: jest.fn(),
  },
}))

import { worktreeRepository } from '@/lib/repositories/worktree.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { worktreeService } from '@/lib/services/worktree.service'

const wt = worktreeRepository as jest.Mocked<typeof worktreeRepository>
const sess = sessionRepository as jest.Mocked<typeof sessionRepository>

beforeEach(() => {
  jest.clearAllMocks()
  wt.upsertWorktree.mockResolvedValue({ id: 'wt_1' } as never)
  wt.markRemoved.mockResolvedValue({ count: 1 } as never)
  sess.linkToWorktreeByCwd.mockResolvedValue({ count: 1 } as never)
})

describe('worktreeService.handleWorktreeCreate', () => {
  it('upserts the worktree and links sessions whose cwd matches the path', async () => {
    await worktreeService.handleWorktreeCreate({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      branch: 'lumo/LUM-9-x',
    })

    expect(wt.upsertWorktree).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      branch: 'lumo/LUM-9-x',
    })
    expect(sess.linkToWorktreeByCwd).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      worktreeId: 'wt_1',
    })
  })

  it('no-ops (no DB writes) when the payload carries no worktree path', async () => {
    await worktreeService.handleWorktreeCreate({
      workspaceId: 'ws_1',
      path: null,
      branch: 'lumo/LUM-9-x',
    })

    expect(wt.upsertWorktree).not.toHaveBeenCalled()
    expect(sess.linkToWorktreeByCwd).not.toHaveBeenCalled()
  })
})

describe('worktreeService.handleWorktreeRemove', () => {
  it('marks the worktree removed', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    await worktreeService.handleWorktreeRemove({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      now,
    })

    expect(wt.markRemoved).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      now,
    })
  })

  it('no-ops when the payload carries no worktree path', async () => {
    await worktreeService.handleWorktreeRemove({
      workspaceId: 'ws_1',
      path: null,
      now: new Date('2026-06-01T12:00:00Z'),
    })

    expect(wt.markRemoved).not.toHaveBeenCalled()
  })
})
