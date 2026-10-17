/**
 * @jest-environment node
 *
 * LUM-1233 batch 1 — one way to read a task. `task show` takes aspect flags
 * (`--full` = the former `task context`, `--memory` = `task context --full`,
 * `--comments`, `--history`, `--scans`, `--runs`, `--outcome`, `--lineage`,
 * `--deps`), defaults to the bound task, and folds every aspect into one
 * `--json` envelope. The removed names are tombstones: they never run, exit 2
 * and name the replacement — and they are not registered commands (no alias).
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
jest.mock('@/cli/src/lib/session-id', () => ({
  resolveSessionId: jest.fn(async () => null),
}))

import fs from 'fs'
import path from 'path'
import {
  selectedAspects,
  showsContext,
  taskShow,
  taskShowUsageError,
} from '@/cli/src/commands/task-show'
import {
  findRemovedCommand,
  removedCommandLines,
  TOMBSTONES,
} from '@/cli/src/lib/removed-commands'
import { classifyError } from '@/cli/src/lib/error-output'
import { EXIT_USAGE } from '@/cli/src/lib/exit-codes'

const TASK = {
  id: 'cm_task',
  identifier: 'LUM-7',
  title: 'Read me',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  description: 'zq-unique-description',
  url: 'https://lumo.test/LUM-7',
  project: { id: 'p1', name: 'Lumo' },
  assignee: null,
}
const CONTEXT = {
  task: {
    identifier: 'LUM-7',
    title: 'Read me',
    status: 'IN_PROGRESS',
    description: 'zq-unique-description',
  },
  memorySection: '## Relevant Memory (1)\n- FULL BODY: Workaround: x',
  memoryIndexSection:
    '## Relevant Memory (1) — headlines only\n- Trap · abcd1234',
  sessions: [],
  nextSteps: [],
}

let out: string
let err: string
let fetchMock: jest.Mock
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status })

function route(over: Record<string, () => Response> = {}) {
  fetchMock = jest.fn(async (url: string) => {
    const p = new URL(String(url)).pathname
    for (const [k, h] of Object.entries(over)) if (p === k) return h()
    if (p === '/api/tasks/by-identifier/LUM-7') return json({ task: TASK })
    if (p === '/api/tasks/context/LUM-7') return json(CONTEXT)
    if (p === '/api/tasks/LUM-7/outcome-signals')
      return json({ verdict: 'INCONCLUSIVE', signals: [] })
    if (p === '/api/tasks/resolve/LUM-7')
      return json({ id: 'cm_task', identifier: 'LUM-7' })
    if (p === '/api/tasks/cm_task/dependencies') return json({ edges: [] })
    throw new Error(`unexpected ${p}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  boundMock.mockReset()
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation(s => {
    err += String(s) + '\n'
  })
  route()
})
afterEach(() => jest.restoreAllMocks())

describe('task show aspects', () => {
  it('selects aspects in print order and decides when the context prints', () => {
    expect(
      selectedAspects({ deps: true, comments: true, outcome: true })
    ).toEqual(['comments', 'outcome', 'deps'])
    expect(showsContext({ full: true })).toBe(true)
    expect(showsContext({ memory: true })).toBe(true)
    // with an aspect, --full is that aspect's long form, not the context
    expect(showsContext({ full: true, runs: true })).toBe(false)
  })

  it('rejects flag combinations that cannot mean one thing (exit 2)', () => {
    expect(taskShowUsageError({ limit: '5' })).toMatch(/--limit/)
    expect(
      taskShowUsageError({ limit: '5', comments: true, history: true })
    ).toMatch(/exactly one/)
    expect(taskShowUsageError({ limit: '5', history: true })).toBeNull()
    expect(taskShowUsageError({ all: true })).toBe('--all goes with --scans')
    expect(taskShowUsageError({ signal: true })).toBe(
      '--signal goes with --lineage'
    )
  })

  it('--full prints the detail view, then the old task context body', async () => {
    const code = await taskShow('LUM-7', { full: true })
    expect(code).toBeUndefined()
    expect(out.startsWith('LUM-7  Read me\n')).toBe(true)
    expect(out).toContain('Priority:')
    // the description prints once, inside the context body
    expect(out.split('zq-unique-description').length - 1).toBe(1)
    expect(out).toContain('# Task: LUM-7')
    expect(out).toContain('headlines only')
    expect(out).not.toContain('FULL BODY')
  })

  it('--memory prints the context with every memory body (old task context --full)', async () => {
    await taskShow('LUM-7', { memory: true })
    expect(out).toContain('FULL BODY')
    expect(out).not.toContain('headlines only')
  })

  it('aspects stack after the detail view', async () => {
    await taskShow('LUM-7', { outcome: true, deps: true })
    const outcomeAt = out.indexOf('Outcome well')
    expect(out.indexOf('LUM-7  Read me')).toBe(0)
    expect(outcomeAt).toBeGreaterThan(0)
    expect(out.search(/dependencies/i)).toBeGreaterThan(outcomeAt)
  })

  it('--json is one envelope with one key per aspect', async () => {
    await taskShow('LUM-7', { json: true, full: true, outcome: true })
    // --full + an aspect = the aspect's long form, so no context key here
    const doc = JSON.parse(out) as Record<string, unknown>
    expect(Object.keys(doc)).toEqual(['version', 'task', 'outcome'])
    expect((doc.task as { ref: string }).ref).toBe('LUM-7')
    expect(
      (doc.outcome as { outcome: { verdict: string } }).outcome.verdict
    ).toBe('INCONCLUSIVE')
    out = ''
    await taskShow('LUM-7', { json: true, memory: true, deps: true })
    const ctx = JSON.parse(out) as Record<string, unknown>
    expect(Object.keys(ctx)).toEqual(['version', 'task', 'context', 'deps'])
    expect(ctx.context).not.toHaveProperty('nextSteps')
  })

  it('defaults to the session-bound task, and says how to bind when there is none', async () => {
    boundMock.mockResolvedValueOnce('LUM-7')
    await taskShow(undefined, {})
    expect(out.startsWith('LUM-7  Read me')).toBe(true)

    out = ''
    boundMock.mockResolvedValueOnce(null)
    const code = await taskShow(undefined, {})
    expect(code).toBe(EXIT_USAGE)
    expect(err).toContain('no task given and this session is not attached')
    expect(err).toContain('lumo session attach <LUM-N>')
  })
})

describe('removed read commands are tombstones, not aliases', () => {
  const cases: Array<[string[], string]> = [
    [['task', 'context', 'LUM-7'], 'lumo task show LUM-7 --full'],
    [
      ['task', 'context', 'LUM-7', '--full'],
      'lumo task show LUM-7 --full --memory',
    ],
    [['task', 'wrapup'], 'lumo task status'],
    [['task', 'wrapup', 'LUM-7'], 'lumo task status LUM-7'],
    [
      ['task', 'comments', 'list', 'LUM-7', '--limit', '5'],
      'lumo task show LUM-7 --comments',
    ],
    [['task', 'history', 'LUM-7'], 'lumo task show LUM-7 --history'],
    [['task', 'scans', 'LUM-7'], 'lumo task show LUM-7 --scans'],
    [['task', 'runs'], 'lumo task show --runs'],
    [['task', 'lineage', 'LUM-7'], 'lumo task show LUM-7 --lineage'],
    [['task', 'deps', 'list', 'LUM-7'], 'lumo task show LUM-7 --deps'],
    [['outcome', 'show', 'LUM-7'], 'lumo task show LUM-7 --outcome'],
    [['--json', 'task', 'context', 'LUM-7'], 'lumo task show LUM-7 --full'],
  ]
  it.each(cases)('%j → %s', (argv, replacement) => {
    const hit = findRemovedCommand(argv)
    expect(hit?.replacement).toBe(replacement)
  })

  it('leaves live commands alone', () => {
    for (const argv of [
      ['task', 'show', 'LUM-7'],
      ['task', 'status'],
      ['task', 'deps', 'add', 'LUM-7', '--blocked-by', 'LUM-1'],
      ['task', 'comments', 'edit', 'LUM-7', 'c1', 'x'],
      ['task', 'comment', 'LUM-7', 'hello'],
    ])
      expect(findRemovedCommand(argv)).toBeNull()
  })

  it('prints one Error line naming the replacement, classified COMMAND_REMOVED', () => {
    const hit = findRemovedCommand(['task', 'context', 'LUM-7'])!
    const [error, hint] = removedCommandLines(hit)
    expect(error).toBe(
      'Error: lumo task context was removed. Use: lumo task show LUM-7 --full'
    )
    expect(hint).toBe('Hint: see `lumo task show --help`.')
    expect(classifyError(2, error!.slice('Error: '.length))).toBe(
      'COMMAND_REMOVED'
    )
    expect(classifyError(2, 'unknown option --x')).toBe('USAGE')
  })

  it('no tombstone path is a registered command (grammar)', () => {
    const grammar = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
        'utf8'
      )
    ) as { commands: Record<string, unknown> }
    for (const t of TOMBSTONES)
      expect(grammar.commands).not.toHaveProperty(t.path)
    expect(grammar.commands).toHaveProperty(['task show'])
  })
})
