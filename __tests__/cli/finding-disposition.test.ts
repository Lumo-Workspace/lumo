/**
 * @jest-environment node
 *
 * LUM-1128: `lumo finding disposition <id...> --false-positive |
 * --accepted-risk [--note]` speaks the standard confirmation protocol
 * (LUM-755): without --confirm it reads the findings from the server, prints
 * ONE confirmation_required envelope (one line per finding) and exits 4,
 * writing nothing; with --confirm it applies each ruling. There is no
 * read-receipt handshake and no agent-session guard (LUM-750's was reverted).
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import {
  findingDisposition,
  describeFindingRulings,
} from '@/cli/src/commands/finding-disposition'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const F1 = {
  id: 'f1',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  ruleId: 'secret:aws',
  filePath: 'lib/a.ts',
  line: 3,
  title: 'AWS key in source',
  statement: 'secret:aws at lib/a.ts:3 — AWS key in source',
  prNumber: 12,
  disposition: null,
  blocking: true,
}
const F2 = {
  ...F1,
  id: 'f2',
  severity: 'MEDIUM',
  provenance: 'EXTERNAL_TOOL',
  ruleId: 'ext:semgrep:x',
  filePath: 'lib/b.ts',
  line: null,
  title: 'Weak hash',
  blocking: false,
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const savedArgv = process.argv
const savedIsTTY = process.stdout.isTTY
const AGENT_ENV = [
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CODEX_THREAD_ID',
  'LUMO_AGENT_SESSION',
] as const
const savedEnv = Object.fromEntries(AGENT_ENV.map(k => [k, process.env[k]]))

function routeFetch(
  opts: { findings?: unknown; post?: (id: string) => unknown } = {}
) {
  fetchMock = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/sessions/')) {
        return jsonResponse(200, { taskIdentifier: 'LUM-741' })
      }
      if (url.endsWith('/security-findings') && !init?.method) {
        return opts.findings ?? jsonResponse(200, { findings: [F1, F2] })
      }
      const m = /\/security-findings\/([^/]+)\/disposition$/.exec(url)
      if (m && init?.method === 'POST') {
        const id = decodeURIComponent(m[1]!)
        if (opts.post) return opts.post(id)
        const body = JSON.parse(init.body ?? '{}') as { disposition: string }
        return jsonResponse(200, {
          id,
          disposition: body.disposition,
          blocking: false,
          channel: 'CLI',
        })
      }
      // The status digest reads after a write — answer it cheaply.
      if (url.endsWith('/status')) {
        return jsonResponse(200, { nextActions: [] })
      }
      if (url.endsWith('/boundary-crossings')) {
        return jsonResponse(200, { crossings: [] })
      }
      throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
    }
  )
  global.fetch = fetchMock as unknown as typeof fetch
}

beforeEach(() => {
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    stderr.push(a.map(String).join(' '))
  })
  Object.defineProperty(process.stdout, 'isTTY', {
    value: false,
    configurable: true,
  })
  process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
  process.argv = [
    'node',
    'lumo',
    'finding',
    'disposition',
    'f1',
    '--false-positive',
  ]
  routeFetch()
})

afterEach(() => {
  jest.restoreAllMocks()
  process.argv = savedArgv
  Object.defineProperty(process.stdout, 'isTTY', {
    value: savedIsTTY,
    configurable: true,
  })
  for (const k of AGENT_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function envelope() {
  return JSON.parse(stdout.join('')) as {
    status: string
    command: string
    changes: string[]
    confirmCommand: string
    receipt?: unknown
  }
}

function writes() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as { method?: string } | undefined)?.method === 'POST'
  )
}

describe('finding disposition — envelope (no --confirm)', () => {
  it('prints one confirmation_required envelope, exits 4, writes nothing', async () => {
    const code = await findingDisposition(['f1'], {
      falsePositive: true,
      note: 'test fixture key',
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(writes()).toHaveLength(0)
    expect(stderr).toEqual([])
    const env = envelope()
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('finding disposition')
    expect(env.receipt).toBeUndefined()
    const line = env.changes.find(l => l.includes('f1'))!
    expect(line).toContain('[HIGH]')
    expect(line).toContain('AWS key in source')
    expect(line).toContain('OPEN → FALSE_POSITIVE')
    expect(line).toContain('test fixture key')
    expect(env.changes.join('\n')).toContain(
      "clears 1 finding's block on moving LUM-741 to DONE"
    )
    expect(env.confirmCommand).toBe(
      'lumo finding disposition f1 --false-positive --confirm'
    )
    expect(env.confirmCommand).not.toContain('--confirm-read')
    expect(env.confirmCommand).not.toContain('--receipt')
  })

  it('several ids → ONE envelope with one line per finding', async () => {
    process.argv = [
      'node',
      'lumo',
      'finding',
      'disposition',
      'f1',
      'f2',
      '--accepted-risk',
    ]
    const code = await findingDisposition(['f1', 'f2'], { acceptedRisk: true })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = envelope()
    const lines = env.changes.filter(l => /^f[12] /.test(l))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('OPEN → ACCEPTED_RISK')
    expect(lines[1]).toContain('[MEDIUM]')
    expect(lines[1]).toContain('advisory')
    expect(env.confirmCommand).toBe(
      'lumo finding disposition f1 f2 --accepted-risk --confirm'
    )
    expect(writes()).toHaveLength(0)
  })

  it('an id not on the task fails closed — no envelope, nothing written', async () => {
    const code = await findingDisposition(['f1', 'nope'], {
      falsePositive: true,
    })
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toContain('nope not found on LUM-741')
    expect(writes()).toHaveLength(0)
  })

  it('a findings read error fails closed, even with --confirm', async () => {
    routeFetch({ findings: jsonResponse(500, { error: 'boom' }) })
    const code = await findingDisposition(['f1'], {
      falsePositive: true,
      confirm: true,
    })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toContain('nothing was written')
    expect(writes()).toHaveLength(0)
  })

  it('a finding already carrying the ruling is skipped; all skipped → exit 0, no envelope', async () => {
    routeFetch({
      findings: jsonResponse(200, {
        findings: [{ ...F1, disposition: 'FALSE_POSITIVE', blocking: false }],
      }),
    })
    const code = await findingDisposition(['f1'], { falsePositive: true })
    expect(code).toBeUndefined()
    expect(stdout.join('')).toContain('already FALSE_POSITIVE')
    expect(writes()).toHaveLength(0)
  })

  it('non-TTY: a mixed batch (one already ruled) keeps stdout exactly one JSON envelope, the skip note inside its changes', async () => {
    routeFetch({
      findings: jsonResponse(200, {
        findings: [
          { ...F1, disposition: 'FALSE_POSITIVE', blocking: false },
          F2,
        ],
      }),
    })
    const code = await findingDisposition(['f1', 'f2'], {
      falsePositive: true,
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    // The whole of stdout parses as ONE JSON document — no prose before it.
    const envelope = JSON.parse(stdout.join('')) as {
      status: string
      changes: string[]
    }
    expect(envelope.status).toBe('confirmation_required')
    expect(envelope.changes).toContain(
      'Finding f1 is already FALSE_POSITIVE — skipped.'
    )
    expect(envelope.changes.some(l => l.startsWith('f2 '))).toBe(true)
    expect(envelope.changes.some(l => l.startsWith('f1 '))).toBe(false)
    expect(writes()).toHaveLength(0)
  })

  it('--confirm on a mixed batch writes only the open one and still reports the skip', async () => {
    routeFetch({
      findings: jsonResponse(200, {
        findings: [
          { ...F1, disposition: 'FALSE_POSITIVE', blocking: false },
          F2,
        ],
      }),
    })
    const code = await findingDisposition(['f1', 'f2'], {
      falsePositive: true,
      confirm: true,
    })
    expect(code).toBeUndefined()
    expect(writes()).toHaveLength(1)
    expect(stdout.join('')).toContain(
      'Finding f1 is already FALSE_POSITIVE — skipped.'
    )
  })

  it('a ruling flag is required, and only one', async () => {
    expect(await findingDisposition(['f1'], {})).toBe(1)
    expect(
      await findingDisposition(['f1'], {
        falsePositive: true,
        acceptedRisk: true,
      })
    ).toBe(1)
    expect(await findingDisposition([], { falsePositive: true })).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('finding disposition — --confirm applies', () => {
  it('POSTs each ruling to the disposition route with the session header and reports each', async () => {
    const code = await findingDisposition(['f1', 'f2'], {
      falsePositive: true,
      note: 'user approved',
      confirm: true,
    })
    expect(code).toBeUndefined()
    const posts = writes()
    expect(posts).toHaveLength(2)
    expect(posts[0]![0]).toBe(
      'https://api.lumo.test/api/tasks/LUM-741/security-findings/f1/disposition'
    )
    const init = posts[0]![1] as {
      headers: Record<string, string>
      body: string
    }
    expect(init.headers['X-Lumo-Session-Id']).toBe('sess-1')
    expect(JSON.parse(init.body)).toEqual({
      disposition: 'FALSE_POSITIVE',
      note: 'user approved',
    })
    const out = stdout.join('')
    expect(out).toContain('✓ f1 → FALSE_POSITIVE')
    expect(out).toContain('✓ f2 → FALSE_POSITIVE')
    expect(out).toContain('channel CLI')
  })

  it('runs with agent-session env vars set — there is no agent guard (it would have refused under #1004)', async () => {
    process.env.CLAUDECODE = '1'
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    process.env.CODEX_THREAD_ID = 'thread-1'
    process.env.LUMO_AGENT_SESSION = '1'
    const code = await findingDisposition(['f1'], {
      falsePositive: true,
      confirm: true,
    })
    expect(code).toBeUndefined()
    expect(writes()).toHaveLength(1)
    expect(stderr.join('\n')).not.toMatch(/agent session/i)
  })

  it('a failed write is reported per finding and exits 1; the others still go through', async () => {
    routeFetch({
      post: id =>
        id === 'f1'
          ? jsonResponse(404, {
              error: 'Security finding not found on this task',
            })
          : jsonResponse(200, { id, disposition: 'FALSE_POSITIVE' }),
    })
    const code = await findingDisposition(['f1', 'f2'], {
      falsePositive: true,
      confirm: true,
    })
    expect(code).toBe(1)
    expect(writes()).toHaveLength(2)
    expect(stderr.join('\n')).toContain('f1')
    expect(stderr.join('\n')).toContain('HTTP 404')
    expect(stdout.join('')).toContain('✓ f2 → FALSE_POSITIVE')
  })
})

describe('describeFindingRulings', () => {
  it('sanitizes untrusted titles and names the advisory consequence', () => {
    const lines = describeFindingRulings(
      [{ ...F2, title: 'bad\u001b[31m title' }],
      'FALSE_POSITIVE',
      { taskIdentifier: 'LUM-1' }
    )
    expect(lines.join('\n')).not.toContain('\u001b')
    expect(lines.join('\n')).toContain('none of these block DONE')
  })
})
