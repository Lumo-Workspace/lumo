/**
 * @jest-environment node
 *
 * LUM-755: every command that used to hard-refuse without --yes now walks
 * the confirmation protocol — without --confirm it exits 4 with a JSON
 * envelope on stdout (changes derived from real state, confirmCommand = the
 * same argv + --confirm) and sends no mutation. --yes stays as an alias.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/resolve', () => ({
  resolveSprintId: jest.fn(async () => ({
    id: 'sprint-uuid',
    number: 3,
    name: 'Sprint 3',
    teamId: 'team-1',
  })),
  resolveMilestoneId: jest.fn(async () => ({
    id: 'ms-uuid',
    name: 'Q3 Launch',
  })),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(async () => 'cmdoc123456789012345678'),
}))
jest.mock('@/cli/src/lib/worktree-ref', () => ({
  resolveWorktreeTaskId: jest.fn(async () => 'LUM-267'),
}))
jest.mock('@/cli/src/lib/worktree', () => ({
  isMainCheckout: jest.fn(() => true),
  getRepoRoot: jest.fn(() => '/repo'),
  gitOutput: jest.fn(),
  runGit: jest.fn(() => ({ status: 0, stderr: '', stdout: '' })),
  parseWorktreePorcelain: jest.fn(() => [
    {
      path: '/repo/.worktrees/LUM-267-x',
      branch: 'lumo/LUM-267-x',
      head: 'abc',
    },
  ]),
  findWorktreeByTaskId: jest.fn((entries: unknown[]) => entries[0]),
  // LUM-825: rm now asks for every match (and refuses when there are several).
  findWorktreesByTaskId: jest.fn((entries: unknown[]) => entries.slice(0, 1)),
}))

// LUM-971: how a removal recovers from a half-delete is covered with real git
// in cli/__tests__/worktree-remove.test.ts; here only the gates matter, so the
// removal just forwards to the mocked `git worktree remove`.
jest.mock('@/cli/src/lib/worktree-remove', () => ({
  removeWorktreeDir: jest.fn(
    (root: string, p: string, opts: { force?: boolean } = {}) => {
      const { runGit } = jest.requireMock('@/cli/src/lib/worktree') as {
        runGit: jest.Mock
      }
      runGit(
        opts.force
          ? ['worktree', 'remove', '--force', p]
          : ['worktree', 'remove', p],
        root
      )
      return { status: 'removed' }
    }
  ),
  describeResidue: jest.fn(() => []),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { taskDepsRm } from '@/cli/src/commands/task-deps'
import { taskArtifactRm } from '@/cli/src/commands/task-artifact-rm'
import { memoryDelete } from '@/cli/src/commands/memory-delete'
import { docDelete } from '@/cli/src/commands/doc-delete'
import { sprintDelete } from '@/cli/src/commands/sprint-delete'
import { milestoneDelete } from '@/cli/src/commands/milestone-delete'
import { sprintClose } from '@/cli/src/commands/sprint-close'
import { worktreeRm } from '@/cli/src/commands/worktree-rm'
import { docRebuildSource } from '@/cli/src/commands/doc-rebuild-source'
import { gitOutput } from '@/cli/src/lib/worktree'

const MUTATING = new Set(['DELETE', 'POST', 'PATCH', 'PUT'])

type Route = (url: string, init?: RequestInit) => unknown

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const savedArgv = process.argv
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function route(handler: Route) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    handler(String(url), init)
  )
}

const mutations = () =>
  fetchMock.mock.calls.filter(([, init]) =>
    MUTATING.has(
      ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
    )
  )

function envelope() {
  const out = stdout.join('')
  const parsed = JSON.parse(out) as {
    status: string
    command: string
    changes: string[]
    confirmCommand: string
  }
  expect(parsed.status).toBe('confirmation_required')
  expect(parsed.changes.length).toBeGreaterThan(0)
  expect(parsed.confirmCommand.endsWith('--confirm')).toBe(true)
  return parsed
}

beforeEach(() => {
  jest.clearAllMocks()
  stdout = []
  stderr = []
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
    writable: true,
  })
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((...a) => {
    stdout.push(a.join(' ') + '\n')
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  if (originalIsTTY)
    Object.defineProperty(process.stdout, 'isTTY', originalIsTTY)
  else delete (process.stdout as { isTTY?: boolean }).isTTY
})

// ---------------------------------------------------------------------------
// Per-command fixtures: the GETs each command needs, plus the mutation route.
// ---------------------------------------------------------------------------

const depsRoutes: Route = (url, init) => {
  if (url.endsWith('/api/tasks/resolve/LUM-42'))
    return jsonRes(200, { id: 'task-42', identifier: 'LUM-42' })
  if (url.endsWith('/api/tasks/task-42/dependencies') && !init?.method)
    return jsonRes(200, {
      dependencies: [
        {
          id: 'a1b2c3d4e5f6',
          direction: 'BLOCKED_BY',
          kind: 'HARD',
          source: 'manual',
          status: 'CONFIRMED',
          reason: null,
          detail: null,
          other: { identifier: 'LUM-9', title: 'Other task', status: 'TODO' },
        },
      ],
    })
  if (init?.method === 'DELETE') return jsonRes(200, {})
  throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
}

const artifactRoutes: Route = (url, init) => {
  if (url.endsWith('/api/tasks/LUM-9/artifacts/a1') && !init?.method)
    return jsonRes(200, {
      artifact: { id: 'a1', kind: 'SPEC', title: 'API spec', source: 'x' },
    })
  if (init?.method === 'DELETE') return jsonRes(204, {})
  throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
}

const memoryRoutes: Route = (url, init) => {
  if (url.endsWith('/api/memories/cm1') && !init?.method)
    return jsonRes(200, {
      memory: {
        id: 'cm1',
        category: 'TRAP',
        content: { situation: 'Entry point eager-imports a devDependency' },
      },
    })
  if (init?.method === 'DELETE') return jsonRes(204, {})
  throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
}

const docRoutes: Route = (url, init) => {
  if (url.endsWith('/api/documents/cmdoc123456789012345678') && !init?.method)
    return jsonRes(200, {
      document: { id: 'cmdoc123456789012345678', title: 'Design notes' },
    })
  if (init?.method === 'DELETE') return jsonRes(200, {})
  throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
}

const sprintRoutes =
  (tasks: unknown[]): Route =>
  (url, init) => {
    if (url.endsWith('/api/sprints/sprint-uuid') && !init?.method)
      return jsonRes(200, {
        sprint: { number: 3, name: 'Sprint 3' },
        progress: { total: tasks.length },
      })
    if (url.endsWith('/api/sprints/sprint-uuid/tasks') && !init?.method)
      return jsonRes(200, { tasks })
    if (init?.method === 'DELETE' || init?.method === 'POST')
      return jsonRes(200, {})
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
  }

const milestoneRoutes: Route = (url, init) => {
  if (url.endsWith('/api/milestones/ms-uuid') && !init?.method)
    return jsonRes(200, {
      milestone: {
        name: 'Q3 Launch',
        taskCounts: { TODO: 5, IN_PROGRESS: 4, IN_REVIEW: 2, DONE: 1 },
      },
    })
  if (init?.method === 'DELETE') return jsonRes(200, {})
  throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
}

const task = (id: string, number: number, status: string) => ({
  id,
  number,
  title: `Task ${number}`,
  status,
  priority: 'MEDIUM',
  teamIdentifier: 'LUM',
  project: { id: 'p', name: 'Lumo' },
})

const rebuildRoutes =
  (sourceExists: boolean): Route =>
  (url, init) => {
    if (url.endsWith('/rebuild-source') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { force?: boolean }
      if (sourceExists && !body.force)
        return jsonRes(409, { error: 'Document already has a markdown source' })
      return jsonRes(200, {
        document: { id: 'cmdoc123456789012345678', title: 'Design notes' },
      })
    }
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
  }

// ---------------------------------------------------------------------------

describe('confirmation envelope', () => {
  it('task deps rm: exit 4, describes the edge, no DELETE', async () => {
    process.argv = ['node', 'lumo', 'task', 'deps', 'rm', 'LUM-42', 'a1b2c3']
    route(depsRoutes)
    const code = await taskDepsRm('LUM-42', 'a1b2c3', {})
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('task deps rm')
    expect(env.changes[0]).toContain('[a1b2c3d4]')
    expect(env.changes[0]).toContain('LUM-42')
    expect(env.changes[0]).toContain('blocked by LUM-9')
    expect(env.changes[0]).toContain('CONFIRMED')
    expect(env.confirmCommand).toBe('lumo task deps rm LUM-42 a1b2c3 --confirm')
    expect(mutations()).toHaveLength(0)
    expect(stderr).toEqual([])
  })

  it('task artifact rm: exit 4, names the artifact, no DELETE', async () => {
    process.argv = ['node', 'lumo', 'task', 'artifact', 'rm', 'LUM-9', 'a1']
    route(artifactRoutes)
    const code = await taskArtifactRm('LUM-9', 'a1', {})
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('task artifact rm')
    expect(env.changes[0]).toContain('a1')
    expect(env.changes[0]).toContain('"API spec"')
    expect(env.changes[0]).toContain('SPEC')
    expect(env.changes.join('\n')).toMatch(/irreversible/i)
    expect(env.confirmCommand).toBe('lumo task artifact rm LUM-9 a1 --confirm')
    expect(mutations()).toHaveLength(0)
  })

  it('memory delete: exit 4, shows category and a content summary, no DELETE', async () => {
    process.argv = ['node', 'lumo', 'memory', 'delete', 'cm1']
    route(memoryRoutes)
    const code = await memoryDelete('cm1', {})
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('memory delete')
    expect(env.changes[0]).toContain('cm1')
    expect(env.changes[0]).toContain('[TRAP]')
    expect(env.changes.join('\n')).toContain(
      'Entry point eager-imports a devDependency'
    )
    expect(env.confirmCommand).toBe('lumo memory delete cm1 --confirm')
    expect(mutations()).toHaveLength(0)
  })

  it('doc delete: exit 4, shows the title and the descendant rule, no DELETE', async () => {
    process.argv = ['node', 'lumo', 'doc', 'delete', 'Design notes']
    route(docRoutes)
    const code = await docDelete('Design notes', {})
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('doc delete')
    expect(env.changes[0]).toContain('cmdoc123456789012345678')
    expect(env.changes[0]).toContain('"Design notes"')
    expect(env.changes.join('\n')).toMatch(/nested under it/i)
    expect(env.confirmCommand).toBe("lumo doc delete 'Design notes' --confirm")
    expect(mutations()).toHaveLength(0)
  })

  it('sprint delete: exit 4, keeps the task-count line, no DELETE', async () => {
    process.argv = ['node', 'lumo', 'sprint', 'delete', '3', '--team', 'core']
    route(sprintRoutes([task('t1', 1, 'TODO'), task('t2', 2, 'DONE')]))
    const code = await sprintDelete('3', { team: 'core' })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('sprint delete')
    expect(env.changes[0]).toContain('sprint #3 "Sprint 3"')
    expect(env.changes[1]).toContain('2 tasks under it keep their data')
    expect(env.changes[1]).toContain('sprintId')
    expect(env.confirmCommand).toBe(
      'lumo sprint delete 3 --team core --confirm'
    )
    expect(mutations()).toHaveLength(0)
  })

  it('milestone delete: exit 4, sums the task counts, no DELETE', async () => {
    process.argv = [
      'node',
      'lumo',
      'milestone',
      'delete',
      'Q3 Launch',
      '--project',
      'lumo',
    ]
    route(milestoneRoutes)
    const code = await milestoneDelete('Q3 Launch', { project: 'lumo' })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('milestone delete')
    expect(env.changes[0]).toContain('milestone "Q3 Launch"')
    expect(env.changes[1]).toContain('12 tasks under it keep their data')
    expect(env.changes[1]).toContain('milestoneId')
    expect(env.confirmCommand).toBe(
      "lumo milestone delete 'Q3 Launch' --project lumo --confirm"
    )
    expect(mutations()).toHaveLength(0)
  })

  it('sprint close --move-all: exit 4, lists the unfinished tasks that would move, no POST', async () => {
    process.argv = ['node', 'lumo', 'sprint', 'close', '3', '--move-all']
    route(
      sprintRoutes([
        task('t1', 1, 'DONE'),
        task('t3', 3, 'IN_PROGRESS'),
        task('t4', 4, 'TODO'),
      ])
    )
    const code = await sprintClose('3', { moveAll: true })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('sprint close')
    expect(env.changes[0]).toContain('sprint #3 "Sprint 3"')
    expect(env.changes.join('\n')).toMatch(/2 unfinished task/)
    expect(env.changes.join('\n')).toMatch(/next sprint/)
    expect(env.changes.join('\n')).toContain('LUM-3')
    expect(env.changes.join('\n')).toContain('LUM-4')
    expect(env.changes.join('\n')).not.toContain('LUM-1')
    expect(env.confirmCommand).toBe('lumo sprint close 3 --move-all --confirm')
    expect(mutations()).toHaveLength(0)
  })

  it('sprint close --backlog-all: the changes say backlog', async () => {
    process.argv = ['node', 'lumo', 'sprint', 'close', '3', '--backlog-all']
    route(sprintRoutes([task('t3', 3, 'IN_PROGRESS')]))
    const code = await sprintClose('3', { backlogAll: true })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.changes.join('\n')).toMatch(/backlog/)
    expect(env.confirmCommand).toBe(
      'lumo sprint close 3 --backlog-all --confirm'
    )
    expect(mutations()).toHaveLength(0)
  })

  it('sprint close without a mode flag and with unfinished tasks is still a plain refusal (exit 1) that points at --confirm', async () => {
    route(sprintRoutes([task('t3', 3, 'IN_PROGRESS')]))
    const code = await sprintClose('3', {})
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toContain('--move-all --confirm')
    expect(stderr.join('\n')).not.toContain('--yes')
    expect(mutations()).toHaveLength(0)
  })

  it('worktree rm (clean): exit 4, names path + branch, no git remove', async () => {
    process.argv = ['node', 'lumo', 'worktree', 'rm', 'LUM-267']
    ;(gitOutput as jest.Mock).mockImplementation((args: string[]) =>
      args[0] === 'status' ? '' : 'porcelain'
    )
    const { runGit } = jest.requireMock('@/cli/src/lib/worktree') as {
      runGit: jest.Mock
    }
    const code = await worktreeRm('LUM-267', {})
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('worktree rm')
    expect(env.changes[0]).toContain('/repo/.worktrees/LUM-267-x')
    expect(env.changes.join('\n')).toContain('lumo/LUM-267-x')
    expect(env.changes.join('\n')).toMatch(/kept/)
    expect(env.confirmCommand).toBe('lumo worktree rm LUM-267 --confirm')
    expect(runGit).not.toHaveBeenCalled()
  })

  it('worktree rm (dirty): the envelope explains the discard and confirmCommand carries --force, even when --confirm was passed', async () => {
    process.argv = ['node', 'lumo', 'worktree', 'rm', 'LUM-267', '--confirm']
    ;(gitOutput as jest.Mock).mockImplementation((args: string[]) =>
      args[0] === 'status' ? ' M file.ts' : 'porcelain'
    )
    const { runGit } = jest.requireMock('@/cli/src/lib/worktree') as {
      runGit: jest.Mock
    }
    const code = await worktreeRm('LUM-267', { confirm: true })
    expect(code).toBe(4)
    const env = envelope()
    expect(env.changes.join('\n')).toMatch(/uncommitted changes/i)
    expect(env.changes.join('\n')).toMatch(/discard/i)
    expect(env.confirmCommand).toBe(
      'lumo worktree rm LUM-267 --force --confirm'
    )
    expect(runGit).not.toHaveBeenCalled()
  })

  it('doc rebuild-source on a doc that already has a source: exit 4 with the server reason, confirmCommand adds only --confirm', async () => {
    process.argv = ['node', 'lumo', 'doc', 'rebuild-source', 'Design notes']
    route(rebuildRoutes(true))
    const code = await docRebuildSource('Design notes', {})
    expect(code).toBe(4)
    const env = envelope()
    expect(env.command).toBe('doc rebuild-source')
    expect(env.changes.join('\n')).toContain(
      'Document already has a markdown source'
    )
    expect(env.changes.join('\n')).toMatch(/replace/i)
    expect(env.confirmCommand).toBe(
      "lumo doc rebuild-source 'Design notes' --confirm"
    )
  })

  it('renders the same envelope as text when stdout is a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    })
    process.argv = ['node', 'lumo', 'memory', 'delete', 'cm1']
    route(memoryRoutes)
    const code = await memoryDelete('cm1', {})
    expect(code).toBe(4)
    const out = stdout.join('')
    expect(() => JSON.parse(out)).toThrow()
    expect(out).toContain('[TRAP]')
    expect(out.trimEnd().endsWith('lumo memory delete cm1 --confirm')).toBe(
      true
    )
    expect(mutations()).toHaveLength(0)
  })
})

describe('--confirm executes the mutation', () => {
  it('task deps rm --confirm sends the DELETE', async () => {
    route(depsRoutes)
    const code = await taskDepsRm('LUM-42', 'a1b2c3', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
    expect(stdout.join('')).toContain(
      'Removed dependency [a1b2c3d4] from LUM-42'
    )
  })

  it('doc rebuild-source --confirm proceeds without an envelope (LUM-1233 3h: no --force)', async () => {
    route(rebuildRoutes(true))
    const code = await docRebuildSource('Design notes', { confirm: true })
    expect(code).toBeUndefined()
    expect(stdout.join('')).toContain('Rebuilt markdown source')
  })

  it('worktree rm --confirm --force removes a dirty worktree', async () => {
    ;(gitOutput as jest.Mock).mockImplementation((args: string[]) =>
      args[0] === 'status' ? ' M file.ts' : 'porcelain'
    )
    const { runGit } = jest.requireMock('@/cli/src/lib/worktree') as {
      runGit: jest.Mock
    }
    const code = await worktreeRm('LUM-267', { confirm: true, force: true })
    expect(code).toBe(0)
    expect(runGit).toHaveBeenCalledWith(
      ['worktree', 'remove', '--force', '/repo/.worktrees/LUM-267-x'],
      '/repo'
    )
  })
})

// LUM-1233 3i: `--yes` was removed; these commands approve with --confirm.
describe('--confirm on the commands that had the --yes alias', () => {
  it('task artifact rm --confirm deletes', async () => {
    route(artifactRoutes)
    const code = await taskArtifactRm('LUM-9', 'a1', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
    expect(stdout.join('')).toContain('Removed a1 from LUM-9')
  })

  it('memory delete --confirm deletes', async () => {
    route(memoryRoutes)
    const code = await memoryDelete('cm1', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
  })

  it('doc delete --confirm deletes', async () => {
    route(docRoutes)
    const code = await docDelete('Design notes', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
  })

  it('sprint delete --confirm deletes', async () => {
    route(sprintRoutes([]))
    const code = await sprintDelete('3', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
  })

  it('milestone delete --confirm deletes', async () => {
    route(milestoneRoutes)
    const code = await milestoneDelete('Q3 Launch', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
  })

  it('sprint close --move-all --confirm closes with move decisions', async () => {
    route(sprintRoutes([task('t3', 3, 'IN_PROGRESS')]))
    const code = await sprintClose('3', { moveAll: true, confirm: true })
    expect(code).toBeUndefined()
    const [post] = mutations()
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      decisions: { t3: 'moveToNext' },
    })
  })

  it('worktree rm --confirm removes a clean worktree', async () => {
    ;(gitOutput as jest.Mock).mockImplementation((args: string[]) =>
      args[0] === 'status' ? '' : 'porcelain'
    )
    const { runGit } = jest.requireMock('@/cli/src/lib/worktree') as {
      runGit: jest.Mock
    }
    const code = await worktreeRm('LUM-267', { confirm: true })
    expect(code).toBe(0)
    expect(runGit).toHaveBeenCalledWith(
      ['worktree', 'remove', '/repo/.worktrees/LUM-267-x'],
      '/repo'
    )
  })

  it('task deps rm --confirm deletes', async () => {
    route(depsRoutes)
    const code = await taskDepsRm('LUM-42', 'a1b2c3', { confirm: true })
    expect(code).toBeUndefined()
    expect(mutations()).toHaveLength(1)
  })
})
