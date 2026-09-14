/**
 * @jest-environment node
 *
 * LUM-769: `lumo crossing disposition <id> --false-positive | --confirmed`
 * walks the LUM-755 confirmation protocol. Without --confirm it reads the
 * crossing, prints an envelope (severity, category, detail, recurrence, the
 * agent's own explanations, a ⚠ line naming the consequence) and exits 4
 * without any write. With --confirm it POSTs the ruling to the task-scoped
 * CLI route. A crossing read that errors fails closed on both paths.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import {
  crossingDisposition,
  describeCrossingDisposition,
} from '@/cli/src/commands/crossing-disposition'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import grammarJson from '@/scripts/analysis/lum392-cli-friction/grammar.json'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const CROSSING = {
  id: 'cx-1',
  category: 'TEST_FILE_DELETED',
  severity: 'MEDIUM',
  detail: 'deleted __tests__/actor-resolution.test.ts',
  occurrenceCount: 2,
  reversible: true,
  advisory: false,
  disposition: null,
  explanations: [
    { note: 'resolveOutboundActor was removed with USER_OAUTH', createdAt: '' },
    { note: 'coverage moved to run-outbound-*.test.ts', createdAt: '' },
  ],
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]
const savedArgv = process.argv
const savedIsTTY = process.stdout.isTTY
const savedSession = process.env.CLAUDE_CODE_SESSION_ID

/** Route each URL the command may hit. */
function routeFetch(
  opts: {
    session?: unknown
    crossings?: unknown
    post?: unknown
  } = {}
) {
  fetchMock = jest.fn(async (url: string, init?: { method?: string }) => {
    if (url.includes('/api/sessions/')) {
      return opts.session ?? jsonResponse(200, { taskIdentifier: 'LUM-741' })
    }
    if (url.endsWith('/boundary-crossings') && !init?.method) {
      return opts.crossings ?? jsonResponse(200, { crossings: [CROSSING] })
    }
    if (url.endsWith('/boundary-crossings/cx-1/disposition')) {
      return (
        opts.post ??
        jsonResponse(200, {
          crossingId: 'cx-1',
          disposition: 'FALSE_POSITIVE',
          channel: 'CLI',
        })
      )
    }
    throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
  })
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
    'crossing',
    'disposition',
    'cx-1',
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
  if (savedSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = savedSession
})

function envelope() {
  return JSON.parse(stdout.join('')) as {
    status: string
    command: string
    changes: string[]
    confirmCommand: string
  }
}

function writes() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as { method?: string } | undefined)?.method === 'POST'
  )
}

describe('crossing disposition', () => {
  it('without --confirm: prints the envelope on stdout, exits 4, sends no write', async () => {
    const code = await crossingDisposition('cx-1', { falsePositive: true })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(writes()).toHaveLength(0)
    expect(stderr).toEqual([])

    const env = envelope()
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('crossing disposition')
    expect(env.confirmCommand).toBe(
      'lumo crossing disposition cx-1 --false-positive --confirm'
    )
    const text = env.changes.join('\n')
    expect(env.changes[0]).toBe(
      'Will disposition crossing cx-1 on LUM-741 as FALSE_POSITIVE'
    )
    expect(text).toContain('Disposition: OPEN → FALSE_POSITIVE')
    expect(text).toContain(
      '[MEDIUM] TEST_FILE_DELETED — deleted __tests__/actor-resolution.test.ts'
    )
    expect(text).toContain('Seen ×2 while open')
    expect(text).toContain(
      'Agent explanations (2, agent self-report · unverified):'
    )
    expect(text).toContain('resolveOutboundActor was removed with USER_OAUTH')
    expect(text).toContain('coverage moved to run-outbound-*.test.ts')
    expect(text).toContain(
      "⚠ Approving clears this crossing's block on moving LUM-741 to DONE"
    )
  })

  it('without --confirm: the note rides in the envelope and in confirmCommand; HIGH + irreversible add ⚠ lines', () => {
    const lines = describeCrossingDisposition(
      {
        ...CROSSING,
        severity: 'HIGH',
        category: 'HARDCODED_SECRET',
        reversible: false,
        occurrenceCount: 1,
        explanations: [],
      },
      'CONFIRMED',
      { taskIdentifier: 'LUM-9', note: 'rotated the key' }
    )
    const text = lines.join('\n')
    expect(text).toContain('Note to record: rotated the key')
    expect(text).toContain('Agent explanations: none recorded')
    expect(text).not.toContain('Seen ×')
    expect(text).toMatch(/⚠ HIGH severity/)
    expect(text).toMatch(/⚠ Irreversible category/)
  })

  it('without --confirm: an advisory crossing says so instead of claiming to clear DONE', () => {
    const lines = describeCrossingDisposition(
      { ...CROSSING, advisory: true },
      'FALSE_POSITIVE',
      { taskIdentifier: 'LUM-9' }
    )
    const text = lines.join('\n')
    expect(text).toContain('Advisory crossing — it never blocked DONE')
    expect(text).not.toContain("clears this crossing's block")
  })

  it('with --confirm: POSTs the disposition and the note, prints the outcome', async () => {
    process.argv.push('--note', 'covered elsewhere', '--confirm')
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      note: 'covered elsewhere',
      confirm: true,
    })
    expect(code).toBeUndefined()
    const [url, init] = writes()[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.lumo.test/api/tasks/LUM-741/boundary-crossings/cx-1/disposition'
    )
    expect(JSON.parse(String(init.body))).toEqual({
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'covered elsewhere',
    })
    expect((init.headers as Record<string, string>)['X-Lumo-Session-Id']).toBe(
      'sess-1'
    )
    const out = stdout.join('')
    expect(out).toContain('✓ Dispositioned crossing cx-1 as FALSE_POSITIVE')
    expect(out).toContain('clears its block on moving LUM-741 to DONE')
    expect(out).toContain('/my-tasks/LUM-741#boundary-crossings')
  })

  it('with --confirm: --confirmed sends CONFIRMED with no note field when none was given', async () => {
    await crossingDisposition('cx-1', { confirmed: true, confirm: true })
    const [, init] = writes()[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ disposition: 'CONFIRMED' })
  })

  it('with --confirm: --task overrides the session binding and a server refusal is a plain exit 1', async () => {
    delete process.env.CLAUDE_CODE_SESSION_ID
    routeFetch({ post: jsonResponse(403, { error: 'nope' }) })
    const code = await crossingDisposition('cx-1', {
      confirmed: true,
      confirm: true,
      task: 'LUM-741',
    })
    expect(code).toBe(1)
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes('/api/sessions/'))
    ).toBe(false)
    expect(stderr.join('\n')).toContain(
      'disposition rejected (HTTP 403) — nope'
    )
  })

  it('fails closed when the crossing read errors: no envelope, no write, exit 1', async () => {
    routeFetch({ crossings: jsonResponse(500, { error: 'boom' }) })
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      confirm: true,
    })
    expect(code).toBe(1)
    expect(writes()).toHaveLength(0)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toMatch(
      /could not confirm the crossing \(HTTP 500\)/
    )
  })

  it('fails closed when the crossing is not on the task, and when no ruling flag or both are given', async () => {
    routeFetch({ crossings: jsonResponse(200, { crossings: [] }) })
    expect(await crossingDisposition('cx-1', { falsePositive: true })).toBe(1)
    expect(stderr.join('\n')).toContain('crossing cx-1 not found on LUM-741')
    expect(writes()).toHaveLength(0)

    stderr = []
    expect(await crossingDisposition('cx-1', {})).toBe(1)
    expect(
      await crossingDisposition('cx-1', {
        falsePositive: true,
        confirmed: true,
      })
    ).toBe(1)
    expect(stderr.join('\n')).toContain(
      'exactly one of --false-positive or --confirmed'
    )
  })

  it('an already-matching ruling is a no-op: no envelope, no write, exit 0', async () => {
    routeFetch({
      crossings: jsonResponse(200, {
        crossings: [{ ...CROSSING, disposition: 'FALSE_POSITIVE' }],
      }),
    })
    const code = await crossingDisposition('cx-1', { falsePositive: true })
    expect(code).toBeUndefined()
    expect(writes()).toHaveLength(0)
    expect(stdout.join('')).toContain('already FALSE_POSITIVE — nothing to do')
  })

  it('unbound session without --task is refused before any read', async () => {
    routeFetch({ session: jsonResponse(200, { taskIdentifier: null }) })
    const code = await crossingDisposition('cx-1', { falsePositive: true })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toContain('not bound to a task')
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).endsWith('/boundary-crossings')
      )
    ).toBe(false)
  })

  it('the command tree lists crossing disposition with its flags (grammar in sync)', () => {
    const cmd = (
      grammarJson as {
        commands: Record<string, { flags: Record<string, unknown> }>
      }
    ).commands['crossing disposition']
    expect(cmd).toBeDefined()
    for (const f of [
      '--false-positive',
      '--confirmed',
      '--note',
      '--task',
      '--confirm',
    ]) {
      expect(Object.keys(cmd?.flags ?? {})).toContain(f)
    }
  })
})
