/**
 * @jest-environment node
 *
 * LUM-1233 batch 1 — server-written text names only the commands the caller's
 * CLI has. A CLI at or above READ_ENTRY_MIN_CLI_VERSION is pointed at
 * `task show --full / --comments / --deps`; an older CLI (or a request with
 * no `X-Lumo-Cli-Version`) keeps the names it has (`task context`, …).
 */
jest.mock('@/lib/repositories/task-dependency.repository', () => ({
  taskDependencyRepository: {
    findLiveBlockersForTask: jest.fn(),
    countSuggestedForTask: jest.fn(),
  },
}))
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: { getContextForIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/next-steps.service', () => ({
  nextStepsService: { forExistingTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/workspace-deletion.service', () => ({
  workspaceDeletionService: {
    buildPendingNoticeSection: jest.fn().mockResolvedValue(''),
  },
}))

import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
  READ_ENTRY_MIN_CLI_VERSION,
  cliCommandNamesForVersion,
  cliCommandNamesFromHeaders,
  resolveReadEntryMinVersion,
} from '@/lib/cli/command-names'
import { renderMemoryIndexBlock } from '@/lib/memory/render'
import { renderCommentsSection } from '@/lib/context/render/comments'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { requireIdentity } from '@/lib/auth/identity'
import { taskContextService } from '@/lib/services/task-context.service'
import { GET as contextGET } from '@/app/api/tasks/context/[identifier]/route'

const REMOVED = [
  /lumo task context\b/,
  /lumo task wrapup\b/,
  /lumo task comments list\b/,
  /lumo task deps list\b/,
]

describe('cliCommandNamesForVersion', () => {
  it('gives the batch-1 names to a CLI at or above the floor', () => {
    expect(cliCommandNamesForVersion(READ_ENTRY_MIN_CLI_VERSION, {})).toBe(
      CURRENT_CLI_COMMANDS
    )
    expect(cliCommandNamesForVersion('1.126.0', {})).toBe(CURRENT_CLI_COMMANDS)
    expect(cliCommandNamesForVersion('2.0.0', {})).toBe(CURRENT_CLI_COMMANDS)
  })

  it('keeps the legacy names for an older, missing or malformed version', () => {
    expect(cliCommandNamesForVersion('1.125.4', {})).toBe(LEGACY_CLI_COMMANDS)
    expect(cliCommandNamesForVersion('1.99.9', {})).toBe(LEGACY_CLI_COMMANDS)
    expect(cliCommandNamesForVersion(null, {})).toBe(LEGACY_CLI_COMMANDS)
    expect(cliCommandNamesForVersion('nightly', {})).toBe(LEGACY_CLI_COMMANDS)
  })

  it('honours a valid env override and ignores a malformed one', () => {
    const env = {
      LUMO_READ_ENTRY_MIN_CLI_VERSION: '1.125.4',
      LUMO_TESTCASE_HANDLE_MIN_CLI_VERSION: '1.125.4',
      LUMO_MEMORY_SCOPE_MIN_CLI_VERSION: '1.125.4',
    }
    expect(resolveReadEntryMinVersion(env)).toBe('1.125.4')
    expect(cliCommandNamesForVersion('1.125.4', env)).toBe(CURRENT_CLI_COMMANDS)
    expect(
      resolveReadEntryMinVersion({ LUMO_READ_ENTRY_MIN_CLI_VERSION: 'x' })
    ).toBe(READ_ENTRY_MIN_CLI_VERSION)
  })

  it('reads the version from X-Lumo-Cli-Version', () => {
    const h = (v?: string) =>
      new Headers(v ? { 'X-Lumo-Cli-Version': v } : undefined)
    expect(cliCommandNamesFromHeaders(h('1.126.0'), {})).toBe(
      CURRENT_CLI_COMMANDS
    )
    expect(cliCommandNamesFromHeaders(h('1.125.4'), {})).toBe(
      LEGACY_CLI_COMMANDS
    )
    expect(cliCommandNamesFromHeaders(h(), {})).toBe(LEGACY_CLI_COMMANDS)
  })

  it('the current names never mention a removed command', () => {
    const out = [
      CURRENT_CLI_COMMANDS.taskContextBound,
      CURRENT_CLI_COMMANDS.taskContext('LUM-1'),
      CURRENT_CLI_COMMANDS.taskContextFull('LUM-1'),
      CURRENT_CLI_COMMANDS.taskComments('LUM-1'),
      CURRENT_CLI_COMMANDS.taskDeps('LUM-1'),
    ].join('\n')
    for (const re of REMOVED) expect(out).not.toMatch(re)
    expect(out).toContain('lumo task show LUM-1 --full --memory')
  })
})

const memory = {
  id: 'cmem00000000000000000001',
  category: 'TRAP' as const,
  scope: 'TASK' as const,
  content: JSON.stringify({ trigger: 'x', outcome: 'y' }),
  createdByMemberId: null,
}

describe('server-rendered pointers', () => {
  it('memory index header: legacy by default, task show for a current CLI', () => {
    const legacy = renderMemoryIndexBlock([memory as never], 'LUM-7')
    expect(legacy).toContain('`lumo task context LUM-7 --full`')
    const current = renderMemoryIndexBlock(
      [memory as never],
      'LUM-7',
      CURRENT_CLI_COMMANDS
    )
    expect(current).toContain('`lumo task show LUM-7 --full --memory`')
    for (const re of REMOVED) expect(current).not.toMatch(re)
  })

  it('comment thread pointer follows the CLI', () => {
    const comments = new Array(4)
      .fill(0)
      .map((_, i) => ({ author: 'A', createdAt: new Date(), body: `c${i}` }))
    const input = { comments, identifier: 'LUM-7', commentsSummary: 'S' }
    expect(renderCommentsSection(input)).toContain(
      'lumo task comments list LUM-7'
    )
    const current = renderCommentsSection({
      ...input,
      commands: CURRENT_CLI_COMMANDS,
    })
    expect(current).toContain('lumo task show LUM-7 --comments')
    for (const re of REMOVED) expect(current).not.toMatch(re)
  })

  it('dependency note follows the CLI', async () => {
    const repo = taskDependencyRepository as jest.Mocked<
      typeof taskDependencyRepository
    >
    repo.findLiveBlockersForTask.mockResolvedValue([])
    repo.countSuggestedForTask.mockResolvedValue(2)
    expect(
      await taskDependencyService.buildBlockerWarningSectionForTask(
        't',
        'LUM-7'
      )
    ).toContain('lumo task deps list LUM-7')
    const current =
      await taskDependencyService.buildBlockerWarningSectionForTask(
        't',
        'LUM-7',
        CURRENT_CLI_COMMANDS
      )
    expect(current).toContain('lumo task show LUM-7 --deps')
    for (const re of REMOVED) expect(current).not.toMatch(re)
  })
})

describe('GET /api/tasks/context/[identifier] picks names by CLI version', () => {
  const mockCtx = taskContextService.getContextForIdentifier as jest.Mock
  beforeEach(() => {
    jest.clearAllMocks()
    ;(requireIdentity as jest.Mock).mockResolvedValue({
      memberId: 'm1',
      workspaceId: 'ws1',
      source: 'bearer',
    })
    mockCtx.mockResolvedValue({ task: { id: 't', identifier: 'LUM-7' } })
  })
  const call = (headers: Record<string, string>) =>
    contextGET(new Request('http://x/api/tasks/context/LUM-7', { headers }), {
      params: Promise.resolve({ identifier: 'LUM-7' }),
    })

  it('an older CLI gets the legacy names', async () => {
    await call({ 'X-Lumo-Cli-Version': '1.125.4' })
    expect(mockCtx.mock.calls[0]![3]).toBe(LEGACY_CLI_COMMANDS)
  })

  it('a request without the header gets the legacy names', async () => {
    await call({})
    expect(mockCtx.mock.calls[0]![3]).toBe(LEGACY_CLI_COMMANDS)
  })

  it('a current CLI gets the task show names', async () => {
    await call({ 'X-Lumo-Cli-Version': READ_ENTRY_MIN_CLI_VERSION })
    expect(mockCtx.mock.calls[0]![3]).toBe(CURRENT_CLI_COMMANDS)
  })
})
