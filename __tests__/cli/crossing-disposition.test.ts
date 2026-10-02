/**
 * @jest-environment node
 *
 * LUM-769: `lumo crossing disposition <id> --false-positive | --confirmed`
 * walks a three-step confirmation handshake the server enforces:
 *   1. no step flag → read the crossing, obtain a stage-1 receipt (no
 *      write), print the read envelope (exit 4) whose confirmCommand carries
 *      `--receipt <r1> --confirm-read`;
 *   2. `--confirm-read --receipt <r1>` → acknowledge the read, obtain the
 *      stage-2 receipt (no write), print the ruling envelope (exit 4) whose
 *      confirmCommand carries `--receipt <r2> --confirm`;
 *   3. `--confirm --receipt <r2>` → POST the ruling.
 * Confirming before the read is acknowledged is refused and told to confirm
 * the read first; a crossing read that errors fails closed on every path.
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
  crossingDisposition,
  describeCrossingDisposition,
  describeRulingConfirmation,
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

const R1 = 'r1.1000.2000.sig1'
const R2 = 'r2.1000.1500.2500.sig2'
const READ_AT = '2026-09-14T10:00:00.000Z'
const ACK_AT = '2026-09-14T10:01:00.000Z'
const EXPIRES = '2026-09-14T10:10:00.000Z'

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
    receipt?: unknown
    acknowledge?: unknown
  } = {}
) {
  fetchMock = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/sessions/')) {
        return opts.session ?? jsonResponse(200, { taskIdentifier: 'LUM-741' })
      }
      if (url.endsWith('/boundary-crossings') && !init?.method) {
        return opts.crossings ?? jsonResponse(200, { crossings: [CROSSING] })
      }
      if (url.endsWith('/boundary-crossings/cx-1/disposition/receipt')) {
        const body = JSON.parse(init?.body ?? '{}') as {
          acknowledge?: string
        }
        if (body.acknowledge) {
          return (
            opts.acknowledge ??
            jsonResponse(200, {
              receipt: R2,
              stage: 'ACK',
              expiresAt: EXPIRES,
              readAt: READ_AT,
              readAcknowledgedAt: ACK_AT,
            })
          )
        }
        return (
          opts.receipt ??
          jsonResponse(200, {
            receipt: R1,
            stage: 'READ',
            expiresAt: EXPIRES,
            readAt: READ_AT,
            readAcknowledgedAt: null,
          })
        )
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
    receipt?: { token: string; expiresAt: string }
  }
}

/** Ruling writes only — the receipt POSTs are handshake calls, not writes. */
function writes() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init as { method?: string } | undefined)?.method === 'POST' &&
      !String(url).endsWith('/receipt')
  )
}

function receiptCalls() {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith('/disposition/receipt')
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
    // Step 1 asks for the READ confirmation, not the ruling.
    expect(env.confirmCommand).toBe(
      `lumo crossing disposition cx-1 --false-positive --receipt ${R1} --confirm-read`
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
    expect(text).toContain('Step 1 of 2 — read receipt issued')
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
    const ruling = describeRulingConfirmation(
      { ...CROSSING, advisory: true },
      'FALSE_POSITIVE',
      { taskIdentifier: 'LUM-9', readAt: READ_AT, readAcknowledgedAt: ACK_AT }
    ).join('\n')
    expect(ruling).toContain('Advisory crossing — it never blocked DONE')
  })

  it('receipt: step 2 --confirm-read acknowledges the read (no write) and prints the ruling envelope carrying the stage-2 receipt and --confirm', async () => {
    process.argv.push('--receipt', R1, '--confirm-read')
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      note: 'covered elsewhere',
      confirmRead: true,
      receipt: R1,
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(writes()).toHaveLength(0)
    expect(receiptCalls()).toHaveLength(1)
    const [, init] = receiptCalls()[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      disposition: 'FALSE_POSITIVE',
      acknowledge: R1,
    })
    const env = envelope()
    expect(env.receipt).toEqual({ token: R2, expiresAt: EXPIRES })
    // The stale stage-1 receipt and --confirm-read are dropped; r2 + --confirm are added.
    expect(env.confirmCommand).toBe(
      `lumo crossing disposition cx-1 --false-positive --receipt ${R2} --confirm`
    )
    const text = env.changes.join('\n')
    expect(text).toContain(
      `Read acknowledged for crossing cx-1 (shown ${READ_AT}, acknowledged ${ACK_AT})`
    )
    expect(text).toContain(
      'Step 2 of 2 — record the ruling: OPEN → FALSE_POSITIVE on LUM-741'
    )
    expect(text).toContain('Note to record: covered elsewhere')
    expect(text).toContain(
      "⚠ Approving clears this crossing's block on moving LUM-741 to DONE"
    )
  })

  it('with --confirm: POSTs the disposition and the note, prints the outcome', async () => {
    process.argv.push(
      '--note',
      'covered elsewhere',
      '--receipt',
      R2,
      '--confirm'
    )
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      note: 'covered elsewhere',
      confirm: true,
      receipt: R2,
    })
    expect(code).toBeUndefined()
    const [url, init] = writes()[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.lumo.test/api/tasks/LUM-741/boundary-crossings/cx-1/disposition'
    )
    expect(JSON.parse(String(init.body))).toEqual({
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'covered elsewhere',
      receipt: R2,
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
    await crossingDisposition('cx-1', {
      confirmed: true,
      confirm: true,
      receipt: R2,
    })
    const [, init] = writes()[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      disposition: 'CONFIRMED',
      receipt: R2,
    })
  })

  it('with --confirm: --task overrides the session binding and a server refusal is a plain exit 1', async () => {
    delete process.env.CLAUDE_CODE_SESSION_ID
    routeFetch({ post: jsonResponse(403, { error: 'nope' }) })
    const code = await crossingDisposition('cx-1', {
      confirmed: true,
      confirm: true,
      receipt: R2,
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
      receipt: R2,
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
    expect(receiptCalls()).toHaveLength(0)
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

  it('receipt: the read step obtains a stage-1 receipt (no write) and the envelope carries it in confirmCommand and as a field', async () => {
    const code = await crossingDisposition('cx-1', { falsePositive: true })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(receiptCalls()).toHaveLength(1)
    const [url, init] = receiptCalls()[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.lumo.test/api/tasks/LUM-741/boundary-crossings/cx-1/disposition/receipt'
    )
    expect(JSON.parse(String(init.body))).toEqual({
      disposition: 'FALSE_POSITIVE',
    })
    expect(writes()).toHaveLength(0)
    const env = envelope()
    expect(env.receipt).toEqual({ token: R1, expiresAt: EXPIRES })
    expect(env.confirmCommand).toContain(`--receipt ${R1} --confirm-read`)
    expect(env.confirmCommand).not.toMatch(/--confirm$/)
  })

  it('receipt: when the server cannot issue one the read step fails closed — no envelope, exit 1', async () => {
    routeFetch({
      receipt: jsonResponse(503, {
        error: 'Read-receipt signing is not configured',
      }),
    })
    const code = await crossingDisposition('cx-1', { falsePositive: true })
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toMatch(
      /could not obtain a read receipt .*HTTP 503 — Read-receipt signing is not configured/
    )
  })

  it('receipt: --confirm without --receipt is refused locally before any request', async () => {
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      confirm: true,
    })
    expect(code).toBe(1)
    expect(writes()).toHaveLength(0)
    expect(receiptCalls()).toHaveLength(0)
    expect(stderr.join('\n')).toContain(
      '--confirm requires the stage-2 read receipt (--receipt <token>) from the --confirm-read step'
    )
  })

  it('receipt: confirming the ruling before the read is acknowledged is refused locally and told to confirm the read first', async () => {
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      confirm: true,
      receipt: R1,
    })
    expect(code).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stderr.join('\n')).toMatch(
      /read not yet acknowledged.*--confirm-read --receipt <this token> first/
    )
  })

  it('receipt: the server also refuses a stage-1 receipt at --confirm (409, confirm read first) — surfaced verbatim, exit 1', async () => {
    routeFetch({
      post: jsonResponse(409, {
        error:
          'Refused: read not yet acknowledged — run the command with --confirm-read (the receipt from the envelope) first; only the receipt that step returns is accepted with --confirm.',
      }),
    })
    // A token the CLI cannot classify locally (crafted prefix) goes to the server.
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      confirm: true,
      receipt: 'r2.forged',
    })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(
      /disposition rejected \(HTTP 409\) — Refused: read not yet acknowledged.*--confirm-read/
    )
  })

  it('receipt: --confirm-read without a receipt, with a stage-2 receipt, or together with --confirm is refused locally', async () => {
    expect(
      await crossingDisposition('cx-1', {
        falsePositive: true,
        confirmRead: true,
      })
    ).toBe(1)
    expect(stderr.join('\n')).toContain(
      '--confirm-read requires the read receipt (--receipt <token>)'
    )
    stderr = []
    expect(
      await crossingDisposition('cx-1', {
        falsePositive: true,
        confirmRead: true,
        receipt: R2,
      })
    ).toBe(1)
    expect(stderr.join('\n')).toContain(
      'this receipt already acknowledges the read — the next step is --confirm'
    )
    stderr = []
    expect(
      await crossingDisposition('cx-1', {
        falsePositive: true,
        confirmRead: true,
        confirm: true,
        receipt: R1,
      })
    ).toBe(1)
    expect(stderr.join('\n')).toContain(
      '--confirm-read and --confirm are separate steps'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('receipt: a server rejection of the acknowledgement (stale stage-1) is a plain exit 1 with the server text, no envelope', async () => {
    routeFetch({
      acknowledge: jsonResponse(409, {
        error:
          'Refused: the read receipt has expired. Re-run the command without --confirm-read to read the crossing again and get a fresh envelope.',
      }),
    })
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      confirmRead: true,
      receipt: R1,
    })
    expect(code).toBe(1)
    expect(stdout.join('')).toBe('')
    expect(stderr.join('\n')).toMatch(
      /read acknowledgement rejected \(HTTP 409 — Refused: the read receipt has expired/
    )
  })

  it('receipt: a server rejection of the receipt at --confirm is a plain exit 1 that says to re-run without --confirm', async () => {
    routeFetch({
      post: jsonResponse(409, {
        error:
          'Refused: the read receipt has expired. Re-run the command without --confirm to read the crossing again and get a fresh envelope.',
      }),
    })
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      confirm: true,
      receipt: 'r2.1.2.3.old',
    })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(
      /disposition rejected \(HTTP 409\) — Refused: the read receipt has expired\. Re-run the command without --confirm/
    )
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
      '--receipt',
      '--confirm-read',
      '--confirm',
    ]) {
      expect(Object.keys(cmd?.flags ?? {})).toContain(f)
    }
  })
})
