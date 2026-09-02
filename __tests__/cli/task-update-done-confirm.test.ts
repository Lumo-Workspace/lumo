/**
 * @jest-environment node
 *
 * LUM-731: `lumo task update <id> --status done` is the one status move that
 * needs a human at the keyboard. The CLI prints what is about to happen (task,
 * current status, linked PRs), asks y/N, and asks a second time when a linked
 * PR is not merged. There is deliberately no --yes / --force bypass — a flag an
 * agent can pass is not a gate.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/tag-resolver', () => ({
  resolveTagRefs: jest.fn(async () => []),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({
  promptLine: jest.fn(),
}))

import { promptLine } from '@/cli/src/lib/line-prompt'
import {
  taskUpdate,
  partitionLinkedPrs,
  formatDoneSummary,
  isAffirmative,
} from '@/cli/src/commands/task-update'
import grammarJson from '@/scripts/analysis/lum392-cli-friction/grammar.json'

const mockPrompt = promptLine as jest.Mock

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

type Pr = {
  number: number
  title: string | null
  url: string | null
  state: string | null
}

function showOk(opts: { status?: string; pullRequests?: Pr[] } = {}) {
  return jsonResponse(200, {
    task: {
      id: 'task-1',
      identifier: 'LUM-1',
      title: 'My Task',
      url: 'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1',
      status: opts.status ?? 'IN_REVIEW',
      priority: 'LOW',
      description: null,
      sprintId: null,
      teamId: 'team-1',
      project: { id: 'proj-1', name: 'Lumo' },
      assignee: null,
      pullRequests: opts.pullRequests ?? [],
    },
  })
}

function patchOk() {
  return jsonResponse(200, {
    task: {
      id: 'task-1',
      identifier: 'LUM-1',
      title: 'My Task',
      url: 'https://api.lumo.test/workspace/lumo/my-tasks/LUM-1',
      taskTags: [],
    },
  })
}

const openPr: Pr = {
  number: 930,
  title: 'feat: wip',
  url: 'https://github.com/o/r/pull/930',
  state: 'open',
}
const mergedPr: Pr = {
  number: 926,
  title: 'refactor: done',
  url: 'https://github.com/o/r/pull/926',
  state: 'merged',
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

function setStdinTTY(value: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  setStdinTTY(true)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (originalIsTTY)
    Object.defineProperty(process.stdin, 'isTTY', originalIsTTY)
  else delete (process.stdin as { isTTY?: boolean }).isTTY
})

const patchCalls = () =>
  fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
  )

describe('pure helpers', () => {
  it('partitionLinkedPrs splits merged from everything else (open, closed, draft, unknown)', () => {
    const closed: Pr = { ...openPr, number: 1, state: 'closed' }
    const unknown: Pr = { ...openPr, number: 2, state: null }
    const { merged, unmerged } = partitionLinkedPrs([
      mergedPr,
      openPr,
      closed,
      unknown,
    ])
    expect(merged.map(p => p.number)).toEqual([926])
    expect(unmerged.map(p => p.number)).toEqual([930, 1, 2])
  })

  it('isAffirmative accepts y/yes case-insensitively and nothing else', () => {
    expect(isAffirmative('y')).toBe(true)
    expect(isAffirmative('YES')).toBe(true)
    expect(isAffirmative(' yes ')).toBe(true)
    expect(isAffirmative('')).toBe(false)
    expect(isAffirmative('n')).toBe(false)
    expect(isAffirmative('yep')).toBe(false)
  })

  it('formatDoneSummary renders title, status arrow, and each PR with its state', () => {
    const text = formatDoneSummary(
      { identifier: 'LUM-1', title: 'My "quoted" Task', status: 'IN_REVIEW' },
      [mergedPr, openPr]
    )
    expect(text).toContain('LUM-1')
    expect(text).toContain('My \\"quoted\\" Task')
    expect(text).toContain('IN_REVIEW → DONE')
    expect(text).toContain('#926')
    expect(text).toContain('merged')
    expect(text).toContain('#930')
    expect(text).toContain('open')
    expect(text).toContain('https://github.com/o/r/pull/930')
  })

  it('formatDoneSummary says none when no PR is linked', () => {
    const text = formatDoneSummary(
      { identifier: 'LUM-1', title: 'T', status: 'TODO' },
      []
    )
    expect(text).toMatch(/Pull requests:\s+none/)
  })
})

describe('taskUpdate --status done confirmation', () => {
  it('non-TTY stdin: exits 1 with an interactive-confirmation error and makes no network call', async () => {
    setStdinTTY(false)
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(stderr.join('\n')).toMatch(/interactive confirmation/i)
    expect(stderr.join('\n')).toMatch(/terminal|web/i)
  })

  it('declined confirmation: prints the task summary and sends no PATCH', async () => {
    fetchMock.mockResolvedValueOnce(showOk({ pullRequests: [mergedPr] }))
    mockPrompt.mockResolvedValueOnce('') // empty answer = default N
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    const out = stdout.join('')
    expect(out).toContain('LUM-1')
    expect(out).toContain('My Task')
    expect(out).toContain('IN_REVIEW → DONE')
    expect(out).toContain('#926')
    expect(mockPrompt).toHaveBeenCalledTimes(1)
    expect(mockPrompt.mock.calls[0][0]).toMatch(/\[y\/N\]/)
    expect(patchCalls()).toHaveLength(0)
    expect(stderr.join('\n')).toMatch(/unchanged|aborted/i)
  })

  it('confirmed with no linked PR: one prompt, then the DONE PATCH is sent', async () => {
    fetchMock
      .mockResolvedValueOnce(showOk({ pullRequests: [] }))
      .mockResolvedValueOnce(patchOk())
    mockPrompt.mockResolvedValueOnce('y')
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBeUndefined()
    expect(stdout.join('')).toMatch(/Pull requests:\s+none/)
    expect(mockPrompt).toHaveBeenCalledTimes(1)
    const patches = patchCalls()
    expect(patches).toHaveLength(1)
    expect(JSON.parse((patches[0][1] as RequestInit).body as string)).toEqual({
      status: 'DONE',
    })
    expect(stdout.join('')).toContain('Updated LUM-1')
  })

  it('all PRs merged: only the first prompt is asked', async () => {
    fetchMock
      .mockResolvedValueOnce(showOk({ pullRequests: [mergedPr] }))
      .mockResolvedValueOnce(patchOk())
    mockPrompt.mockResolvedValueOnce('yes')
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBeUndefined()
    expect(mockPrompt).toHaveBeenCalledTimes(1)
    expect(patchCalls()).toHaveLength(1)
  })

  it('unmerged PR: requires a second confirmation before the PATCH', async () => {
    // Decline the second prompt → no PATCH.
    fetchMock.mockResolvedValueOnce(
      showOk({ pullRequests: [mergedPr, openPr] })
    )
    mockPrompt.mockResolvedValueOnce('y').mockResolvedValueOnce('n')
    let code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    expect(mockPrompt).toHaveBeenCalledTimes(2)
    expect(mockPrompt.mock.calls[1][0]).toMatch(/\[y\/N\]/)
    const out = stdout.join('')
    expect(out).toMatch(/not merged/i)
    expect(out).toContain('#930')
    expect(out).not.toMatch(/not merged[\s\S]*#926/)
    expect(patchCalls()).toHaveLength(0)

    // Confirm both → PATCH sent.
    jest.clearAllMocks()
    fetchMock
      .mockResolvedValueOnce(showOk({ pullRequests: [mergedPr, openPr] }))
      .mockResolvedValueOnce(patchOk())
    mockPrompt.mockResolvedValueOnce('y').mockResolvedValueOnce('y')
    code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBeUndefined()
    expect(mockPrompt).toHaveBeenCalledTimes(2)
    expect(patchCalls()).toHaveLength(1)
  })

  it('first prompt declined with an unmerged PR: the second prompt is never reached', async () => {
    fetchMock.mockResolvedValueOnce(showOk({ pullRequests: [openPr] }))
    mockPrompt.mockResolvedValueOnce('n')
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    expect(mockPrompt).toHaveBeenCalledTimes(1)
    expect(patchCalls()).toHaveLength(0)
  })

  it('task lookup failure (404) aborts before any prompt', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: 'Task LUM-1 not found' })
    )
    const code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(patchCalls()).toHaveLength(0)
    expect(stderr.join('\n')).toContain('Task LUM-1 not found')
  })

  it('other statuses and server 409 pass-through', async () => {
    // --status in_progress: no prompt, no lookup, PATCH straight away.
    fetchMock.mockResolvedValueOnce(patchOk())
    let code = await taskUpdate('LUM-1', { status: 'in_progress' })
    expect(code).toBeUndefined()
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')

    // Confirmed DONE, but the server's gate refuses → message verbatim, exit 1.
    jest.clearAllMocks()
    const gateMsg =
      'Cannot move this task to DONE — 1 unresolved send-back on the acceptance contract'
    fetchMock
      .mockResolvedValueOnce(showOk({ pullRequests: [] }))
      .mockResolvedValueOnce(jsonResponse(409, { error: gateMsg }))
    mockPrompt.mockResolvedValueOnce('y')
    code = await taskUpdate('LUM-1', { status: 'done' })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toContain(gateMsg)
  })

  it('task update grammar has no confirmation-bypass flag', () => {
    const grammar = grammarJson as {
      commands: Record<string, { flags: Record<string, unknown> }>
    }
    const entry = grammar.commands['task update']
    expect(entry).toBeDefined()
    const flags = Object.keys(entry?.flags ?? {})
    expect(flags.length).toBeGreaterThan(0)
    for (const flag of flags) {
      expect(flag).not.toMatch(
        /^--(yes|force|confirm|no-confirm|skip-confirm)$/
      )
    }
  })
})
