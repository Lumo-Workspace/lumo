/**
 * @jest-environment node
 *
 * LUM-1233 batch 3b — one `memory` noun, the scope a flag. `memory add|list`
 * take `--scope task|project`, `--task`, `--project`; `memory update
 * --scope project` replaces `memory promote`; `memory delete` replaces
 * `memory rm`; `memory list --learnings` replaces `workspace learnings`.
 * The old spellings are tombstones, not aliases.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
const boundMock = jest.fn()
jest.mock('@/cli/src/lib/resolve-bound-task', () => ({
  resolveBoundTaskIdentifier: (...a: unknown[]) => boundMock(...a),
}))

import fs from 'fs'
import path from 'path'
import {
  memoryAdd,
  memoryList,
  memoryUpdate,
  resolveMemoryScope,
} from '@/cli/src/commands/memory'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'

const PROJECT = '01234567-89ab-cdef-0123-456789abcdef'
let fetchMock: jest.Mock
let err: string
const urls = () => fetchMock.mock.calls.map(c => String(c[0]))

beforeEach(() => {
  err = ''
  boundMock.mockReset()
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  jest.spyOn(console, 'error').mockImplementation(s => {
    err += String(s) + '\n'
  })
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/tasks/resolve/'))
      return new Response(
        JSON.stringify({ id: 'cm_task', identifier: 'LUM-7' })
      )
    if (u.includes('/api/tasks/by-identifier/'))
      return new Response(
        JSON.stringify({
          task: { identifier: 'LUM-7', project: { id: PROJECT } },
        })
      )
    if (/\/api\/projects(\?|$)/.test(u))
      return new Response(
        JSON.stringify({
          projects: [{ id: PROJECT, name: 'lumo', slug: 'lumo' }],
        })
      )
    if (u.endsWith('/memories') && init?.method === 'POST')
      return new Response(
        JSON.stringify({
          outcome: 'ADD',
          memory: { id: 'cmem000000000000kp5brom5' },
        }),
        { status: 201 }
      )
    if (u.endsWith('/memories'))
      return new Response(JSON.stringify({ memories: [] }))
    if (u.includes('/security-scan/learnings'))
      return new Response(JSON.stringify({ learnings: [] }))
    throw new Error(`unexpected ${u}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

describe('resolveMemoryScope', () => {
  it.each([
    [{}, 'task'],
    [{ task: 'LUM-1' }, 'task'],
    [{ project: 'lumo' }, 'project'],
    [{ scope: 'project' }, 'project'],
    [{ scope: 'PROJECT', project: 'lumo' }, 'project'],
    [{ scope: 'task', task: 'LUM-1' }, 'task'],
  ])('%j → %s', (o, scope) => {
    expect(resolveMemoryScope(o)).toEqual({ ok: true, scope })
  })

  it.each([
    [{ scope: 'milestone' }, /invalid --scope/],
    [{ scope: 'project', task: 'LUM-1' }, /--task goes with the task scope/],
    [{ scope: 'task', project: 'lumo' }, /--project goes with --scope project/],
    [{ task: 'LUM-1', project: 'lumo' }, /--project goes with --scope project/],
  ])('%j is a usage error', (o, re) => {
    const r = resolveMemoryScope(o)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(re)
  })
})

const TRAP = { category: 'trap', trigger: 't', outcome: 'o' }

describe('memory add / list route by scope', () => {
  it('task scope (default) posts to the task, bound task by default', async () => {
    boundMock.mockResolvedValue('LUM-7')
    expect(await memoryAdd({ ...TRAP })).toBeUndefined()
    expect(urls()).toContain('https://api.lumo.test/api/tasks/cm_task/memories')
  })

  it('--scope project posts to the project of the bound task', async () => {
    boundMock.mockResolvedValue('LUM-7')
    await memoryAdd({ ...TRAP, scope: 'project' })
    expect(urls()).toContain(
      `https://api.lumo.test/api/projects/${PROJECT}/memories`
    )
  })

  it('--project alone lists the project scope', async () => {
    await memoryList({ project: 'lumo' })
    expect(urls()).toContain(
      `https://api.lumo.test/api/projects/${PROJECT}/memories`
    )
  })

  it('--learnings reads the PR-review learnings; it takes no scope flags', async () => {
    await memoryList({ learnings: true, repo: 'acme/app' })
    expect(urls().some(u => u.includes('/security-scan/learnings'))).toBe(true)
    fetchMock.mockClear()
    expect(await memoryList({ learnings: true, scope: 'project' })).toBe(2)
    expect(await memoryList({ repo: 'acme/app' })).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a bad combination exits 2 before any request', async () => {
    expect(await memoryAdd({ ...TRAP, scope: 'project', task: 'LUM-1' })).toBe(
      2
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('memory update', () => {
  it('needs --scope project', async () => {
    expect(await memoryUpdate('kp5brom5', {})).toBe(2)
    expect(await memoryUpdate('kp5brom5', { scope: 'task' })).toBe(2)
    expect(err).toContain('only moves from the task scope to the project scope')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('removed spellings are tombstones', () => {
  const values = new Set([
    '--category',
    '--trigger',
    '--outcome',
    '--what',
    '--why',
    '--rule',
    '--applies',
    '--repo',
    '--limit',
    '-n',
    '--project',
    '--task',
    '--scope',
  ])
  const takesValue = (_p: string, f: string) => values.has(f)
  it.each([
    [
      [
        'task',
        'memory',
        'add',
        'LUM-7',
        '--category',
        'trap',
        '--trigger',
        'x y',
      ],
      "lumo memory add --task LUM-7 --category trap --trigger 'x y'",
    ],
    [['task', 'memory', 'list'], 'lumo memory list'],
    [
      ['project', 'memory', 'add', 'lumo', '--category', 'convention'],
      'lumo memory add --scope project --project lumo --category convention',
    ],
    [['project', 'memory', 'list'], 'lumo memory list --scope project'],
    [
      ['memory', 'promote', 'kp5brom5'],
      'lumo memory update kp5brom5 --scope project',
    ],
    [['memory', 'rm', 'kp5brom5', '--yes'], 'lumo memory delete kp5brom5'],
    [
      ['workspace', 'learnings', '--repo', 'acme/app'],
      'lumo memory list --learnings --repo acme/app',
    ],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, takesValue)?.replacement).toBe(replacement)
  })

  it('live memory commands are untouched, and none of the old paths is registered', () => {
    for (const argv of [
      ['memory', 'add', '--category', 'trap'],
      ['memory', 'list', '--scope', 'project'],
      ['memory', 'show', 'kp5brom5'],
      ['memory', 'delete', 'kp5brom5'],
    ])
      expect(findRemovedCommand(argv, takesValue)).toBeNull()
    const grammar = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
        'utf8'
      )
    ) as { commands: Record<string, unknown> }
    for (const p of [
      'task memory',
      'task memory add',
      'project memory list',
      'memory promote',
      'memory rm',
      'workspace learnings',
    ])
      expect(grammar.commands).not.toHaveProperty([p])
    for (const p of [
      'memory add',
      'memory list',
      'memory update',
      'memory delete',
    ])
      expect(grammar.commands).toHaveProperty([p])
  })
})
