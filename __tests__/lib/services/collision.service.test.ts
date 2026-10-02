/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findRecentOtherSessionWritesToFile: jest.fn(),
  },
}))

import type { TaskArtifactAgent } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { collisionService } from '@/lib/services/collision.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>

// Fixed "now" so relative-time rendering is deterministic.
const NOW = new Date('2026-06-01T12:00:00Z')

function row(overrides: {
  sessionId: string
  agent?: string
  minutesAgo: number
  toolName?: string
  branch?: string | null
}) {
  return {
    sessionId: overrides.sessionId,
    toolName: overrides.toolName ?? 'Edit',
    createdAt: new Date(NOW.getTime() - overrides.minutesAgo * 60_000),
    session: {
      agent: (overrides.agent ?? 'CLAUDE_CODE') as TaskArtifactAgent,
      worktree:
        overrides.branch === undefined ? null : { branch: overrides.branch },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.findRecentOtherSessionWritesToFile.mockResolvedValue([])
})

describe('collisionService.checkFileCollision — gating (no DB call)', () => {
  it('returns null and does not query for a non-write tool', async () => {
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Read',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result).toBeNull()
    expect(repo.findRecentOtherSessionWritesToFile).not.toHaveBeenCalled()
  })

  it('returns null and does not query when filePath is missing', async () => {
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: null,
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result).toBeNull()
    expect(repo.findRecentOtherSessionWritesToFile).not.toHaveBeenCalled()
  })

  it('returns null and does not query when sessionId is missing', async () => {
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId: null,
      now: NOW,
    })
    expect(result).toBeNull()
    expect(repo.findRecentOtherSessionWritesToFile).not.toHaveBeenCalled()
  })
})

describe('collisionService.checkFileCollision — querying', () => {
  it('queries with a 30-minute window and the write-tool set, excluding self', async () => {
    await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(repo.findRecentOtherSessionWritesToFile).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      excludeSessionFamilyRoot: 'sess_self',
      since: new Date(NOW.getTime() - 30 * 60_000),
      toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    })
  })

  it('returns null when no other session has touched the file', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it('warns naming the other agent, the file, and how long ago', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([
      row({ sessionId: 'sess_other', agent: 'CODEX', minutesAgo: 3 }),
    ])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/app/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result).not.toBeNull()
    expect(result!.warning).toContain('/repo/app/a.ts')
    expect(result!.warning).toContain('Codex')
    expect(result!.warning).toContain('3 min ago')
  })

  it('names the other session branch when its worktree is known', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([
      row({
        sessionId: 'sess_other',
        agent: 'CODEX',
        minutesAgo: 2,
        branch: 'lumo/LUM-149-x',
      }),
    ])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/app/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result!.warning).toContain('lumo/LUM-149-x')
    expect(result!.warning).toContain('Codex')
  })

  it('falls back to agent only when the worktree branch is unknown', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([
      row({ sessionId: 'sess_other', agent: 'CODEX', minutesAgo: 2 }),
    ])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/app/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result!.warning).toContain('Codex')
    expect(result!.warning).not.toContain('branch')
  })

  it('dedupes multiple events from the same other session, keeping the most recent', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([
      row({ sessionId: 'sess_other', agent: 'CLAUDE_CODE', minutesAgo: 1 }),
      row({ sessionId: 'sess_other', agent: 'CLAUDE_CODE', minutesAgo: 8 }),
    ])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    // One session → mentioned once, with the most-recent (1 minute) timestamp.
    expect(result!.warning).toContain('1 min ago')
    expect(result!.warning).not.toContain('8 min ago')
  })

  it('summarizes the overflow when more than three other sessions collide', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([
      row({ sessionId: 's1', minutesAgo: 1 }),
      row({ sessionId: 's2', minutesAgo: 2 }),
      row({ sessionId: 's3', minutesAgo: 3 }),
      row({ sessionId: 's4', minutesAgo: 4 }),
    ])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result!.warning).toContain('4')
  })

  it('renders "just now" for a sub-minute collision', async () => {
    repo.findRecentOtherSessionWritesToFile.mockResolvedValue([
      row({ sessionId: 'sess_other', minutesAgo: 0 }),
    ])
    const result = await collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId: 'sess_self',
      now: NOW,
    })
    expect(result!.warning).toContain('just now')
  })
})

describe('collisionService.checkFileCollision — session families (LUM-932)', () => {
  // In-memory stand-in for the repository's family-exclusion WHERE clause
  // (`NOT sessionId = root AND NOT sessionId LIKE 'root:%'`, nulls excluded).
  function serveFrom(rows: ReturnType<typeof row>[]) {
    repo.findRecentOtherSessionWritesToFile.mockImplementation(
      async ({ excludeSessionFamilyRoot: root }) =>
        rows.filter(
          r =>
            r.sessionId !== null &&
            r.sessionId !== root &&
            !r.sessionId.startsWith(`${root}:`)
        )
    )
  }
  const check = (sessionId: string) =>
    collisionService.checkFileCollision({
      workspaceId: 'ws_1',
      filePath: '/repo/a.ts',
      toolName: 'Edit',
      sessionId,
      now: NOW,
    })

  it('excludes the family rooted at the parent when called from a child session', async () => {
    await check('sess_parent:agent1')
    expect(repo.findRecentOtherSessionWritesToFile).toHaveBeenCalledWith(
      expect.objectContaining({ excludeSessionFamilyRoot: 'sess_parent' })
    )
  })

  it('does not warn when a parent edits a file its own subagent just edited', async () => {
    serveFrom([row({ sessionId: 'sess_parent:agent1', minutesAgo: 1 })])
    expect(await check('sess_parent')).toBeNull()
  })

  it('does not warn between a subagent, its parent and a sibling subagent', async () => {
    serveFrom([
      row({ sessionId: 'sess_parent', minutesAgo: 2 }),
      row({ sessionId: 'sess_parent:agent2', minutesAgo: 1 }),
    ])
    expect(await check('sess_parent:agent1')).toBeNull()
  })

  it('still warns between two different top-level sessions', async () => {
    serveFrom([row({ sessionId: 'sess_other', agent: 'CODEX', minutesAgo: 1 })])
    const result = await check('sess_parent')
    expect(result).not.toBeNull()
    expect(result!.warning).toContain('/repo/a.ts')
  })

  it("still warns when another session's subagent edited the file", async () => {
    serveFrom([row({ sessionId: 'sess_other:agent9', minutesAgo: 1 })])
    expect(await check('sess_parent:agent1')).not.toBeNull()
  })
})
