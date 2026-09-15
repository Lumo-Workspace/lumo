/**
 * @jest-environment node
 *
 * LUM-750: `lumo finding disposition <id> --false-positive | --accept-risk`
 * walks the LUM-769 three-step handshake for a PR security finding:
 *   1. no step flag → read the finding, obtain a stage-1 receipt (no write),
 *      print the read envelope (exit 4) whose confirmCommand carries
 *      `--receipt <r1> --confirm-read`;
 *   2. `--confirm-read --receipt <r1>` → stage-2 receipt (no write), ruling
 *      envelope (exit 4) whose confirmCommand carries `--receipt <r2> --confirm`;
 *   3. `--confirm --receipt <r2>` → POST the ruling.
 * `--all-suggested-fp` binds the whole suggested set and lists every row.
 * Run as the user, in a plain terminal (no agent markers), with --task.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import {
  findingDisposition,
  describeFindingDisposition,
  describeBulkDisposition,
  type FindingForDisposition,
} from '@/cli/src/commands/finding-disposition'
import { AGENT_SESSION_ENV_VARS } from '@/cli/src/lib/agent-env-guard'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import grammarJson from '@/scripts/analysis/lum392-cli-friction/grammar.json'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const FINDING: FindingForDisposition = {
  id: 'f-1',
  ruleId: 'ext:semgrep:sqli',
  severity: 'HIGH',
  provenance: 'EXTERNAL_TOOL',
  filePath: 'lib/q.ts',
  line: 40,
  title: 'raw SQL built from request input',
  prNumber: 12,
  disposition: null,
  blocking: true,
  persisting: false,
  queueExit: null,
  suggestedDisposition: 'FALSE_POSITIVE',
  suggestedReason: 'input is a parsed integer id',
}

const SUGGESTED_ROWS = [
  {
    id: 'f-1',
    ruleId: 'ext:semgrep:sqli',
    severity: 'HIGH',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'lib/q.ts',
    line: 40,
    title: 'raw SQL built from request input',
    suggestedReason: 'input is a parsed integer id',
  },
  {
    id: 'f-3',
    ruleId: 'ext:semgrep:xss',
    severity: 'MEDIUM',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'app/x.tsx',
    line: null,
    title: 'unescaped output',
    suggestedReason: null,
  },
]

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
const SAVED_ENV: Record<string, string | undefined> = {}

function routeFetch(
  opts: {
    findings?: unknown
    receipt?: unknown
    acknowledge?: unknown
    post?: unknown
    bulkReceipt?: unknown
    bulkAcknowledge?: unknown
    bulkPost?: unknown
  } = {}
) {
  fetchMock = jest.fn(
    async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes('/api/sessions/')) {
        throw new Error('the session binding must never be consulted')
      }
      if (url.endsWith('/security-findings') && !init?.method) {
        return opts.findings ?? jsonResponse(200, { findings: [FINDING] })
      }
      const body = JSON.parse(init?.body ?? '{}') as { acknowledge?: string }
      if (url.endsWith('/security-findings/f-1/disposition/receipt')) {
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
      if (url.endsWith('/security-findings/f-1/disposition/cli')) {
        return (
          opts.post ??
          jsonResponse(200, {
            id: 'f-1',
            disposition: 'FALSE_POSITIVE',
            channel: 'CLI',
          })
        )
      }
      if (url.endsWith('/security-findings/bulk-disposition/receipt')) {
        if (body.acknowledge) {
          return (
            opts.bulkAcknowledge ??
            jsonResponse(200, {
              receipt: R2,
              stage: 'ACK',
              expiresAt: EXPIRES,
              readAt: READ_AT,
              readAcknowledgedAt: ACK_AT,
              findings: SUGGESTED_ROWS,
            })
          )
        }
        return (
          opts.bulkReceipt ??
          jsonResponse(200, {
            receipt: R1,
            stage: 'READ',
            expiresAt: EXPIRES,
            readAt: READ_AT,
            readAcknowledgedAt: null,
            findings: SUGGESTED_ROWS,
          })
        )
      }
      if (url.endsWith('/security-findings/bulk-disposition/cli')) {
        return (
          opts.bulkPost ?? jsonResponse(200, { confirmed: 2, channel: 'CLI' })
        )
      }
      throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
    }
  )
  global.fetch = fetchMock as unknown as typeof fetch
}

beforeEach(() => {
  for (const k of AGENT_SESSION_ENV_VARS) {
    SAVED_ENV[k] = process.env[k]
    delete process.env[k]
  }
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
  process.argv = [
    'node',
    'lumo',
    'finding',
    'disposition',
    'f-1',
    '--false-positive',
    '--task',
    'LUM-750',
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
  for (const k of AGENT_SESSION_ENV_VARS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED_ENV[k]
  }
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

/** Ruling writes only — receipt POSTs are handshake calls, not writes. */
function writes() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init as { method?: string } | undefined)?.method === 'POST' &&
      !String(url).endsWith('/receipt')
  )
}

const run = (o: Parameters<typeof findingDisposition>[1]) =>
  findingDisposition('f-1', { task: 'LUM-750', ...o })

describe('finding disposition — single finding', () => {
  it('step 1: prints the read envelope with the stage-1 receipt, exits 4, sends no write', async () => {
    const code = await run({ falsePositive: true })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(writes()).toHaveLength(0)
    expect(stderr).toEqual([])
    const env = envelope()
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('finding disposition')
    expect(env.confirmCommand).toBe(
      `lumo finding disposition f-1 --false-positive --task LUM-750 --receipt ${R1} --confirm-read`
    )
    expect(env.receipt).toEqual({ token: R1, expiresAt: EXPIRES })
    expect(env.changes[0]).toBe(
      'Will disposition security finding f-1 on LUM-750 as FALSE_POSITIVE'
    )
    expect(env.changes).toContain('Disposition: OPEN → FALSE_POSITIVE')
    expect(env.changes).toContain(
      '[HIGH] EXTERNAL_TOOL ext:semgrep:sqli — lib/q.ts:40 (PR #12)'
    )
    expect(env.changes).toContain('Title: raw SQL built from request input')
    expect(env.changes).toContain(
      'Suggested by the falsifier (LLM suggestion · unverified): FALSE_POSITIVE — input is a parsed integer id'
    )
    expect(env.changes).toContain(
      "⚠ Approving clears this finding's block on moving LUM-750 to DONE"
    )
    expect(env.changes.some(l => l.startsWith('Step 1 of 2'))).toBe(true)
    // The stage-1 receipt was requested for THIS ruling.
    const receiptCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/f-1/disposition/receipt')
    ) as [string, { body: string }]
    expect(JSON.parse(receiptCall[1].body)).toEqual({
      disposition: 'FALSE_POSITIVE',
    })
  })

  it('step 1: --accept-risk adds its ⚠ line, the note rides along, an advisory row says so', () => {
    const lines = describeFindingDisposition(
      { ...FINDING, blocking: false, persisting: true, severity: 'MEDIUM' },
      'ACCEPTED_RISK',
      { taskIdentifier: 'LUM-750', note: 'known, tracked in LUM-9' }
    )
    expect(lines).toContain('Note to record: known, tracked in LUM-9')
    expect(lines.some(l => l.startsWith('Advisory finding'))).toBe(true)
    expect(lines.some(l => l.includes('ACCEPTED_RISK records'))).toBe(true)
    expect(lines.some(l => l.includes('HIGH severity'))).toBe(false)
  })

  it('step 2: --confirm-read acknowledges the read (no write) and prints the ruling envelope with the stage-2 receipt and --confirm', async () => {
    process.argv = [...process.argv, '--receipt', R1, '--confirm-read']
    const code = await run({
      falsePositive: true,
      confirmRead: true,
      receipt: R1,
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(writes()).toHaveLength(0)
    const env = envelope()
    expect(env.confirmCommand).toBe(
      `lumo finding disposition f-1 --false-positive --task LUM-750 --receipt ${R2} --confirm`
    )
    expect(env.receipt?.token).toBe(R2)
    expect(env.changes[0]).toContain(`shown ${READ_AT}, acknowledged ${ACK_AT}`)
    expect(env.changes).toContain(
      'Step 2 of 2 — record the ruling: OPEN → FALSE_POSITIVE on LUM-750'
    )
    const ack = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/f-1/disposition/receipt')
    ) as [string, { body: string }]
    expect(JSON.parse(ack[1].body)).toEqual({
      disposition: 'FALSE_POSITIVE',
      acknowledge: R1,
    })
  })

  it('step 3: --confirm with the stage-2 receipt POSTs the ruling and the note', async () => {
    const code = await run({
      falsePositive: true,
      confirm: true,
      receipt: R2,
      note: 'parsed integer id',
    })
    expect(code).toBeUndefined()
    const [url, init] = writes()[0] as [string, { body: string }]
    expect(url).toBe(
      'https://api.lumo.test/api/tasks/LUM-750/security-findings/f-1/disposition/cli'
    )
    expect(JSON.parse(init.body)).toEqual({
      disposition: 'FALSE_POSITIVE',
      note: 'parsed integer id',
      receipt: R2,
    })
    expect(stdout.join('')).toContain(
      '✓ Dispositioned finding f-1 as FALSE_POSITIVE'
    )
    expect(stdout.join('')).toContain(
      'clears its block on moving LUM-750 to DONE'
    )
  })

  it('--confirm without a receipt, or with the stage-1 receipt, is refused locally before any request', async () => {
    expect(await run({ falsePositive: true, confirm: true })).toBe(1)
    expect(stderr.join('\n')).toContain('requires the stage-2 read receipt')
    stderr = []
    expect(await run({ falsePositive: true, confirm: true, receipt: R1 })).toBe(
      1
    )
    expect(stderr.join('\n')).toContain('read not yet acknowledged')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('--confirm-read without a receipt, with a stage-2 receipt, or with --confirm at once is refused locally', async () => {
    expect(await run({ falsePositive: true, confirmRead: true })).toBe(1)
    expect(
      await run({ falsePositive: true, confirmRead: true, receipt: R2 })
    ).toBe(1)
    expect(
      await run({
        falsePositive: true,
        confirmRead: true,
        confirm: true,
        receipt: R1,
      })
    ).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the server refusing a stage-1 receipt at --confirm (409) is surfaced verbatim, exit 1', async () => {
    routeFetch({
      post: jsonResponse(409, {
        error:
          'read not yet acknowledged — run the command with --confirm-read first',
      }),
    })
    const code = await run({ falsePositive: true, confirm: true, receipt: R2 })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toContain('read not yet acknowledged')
  })

  it('fails closed when the finding read errors or the receipt cannot be issued: no envelope, no write, exit 1', async () => {
    routeFetch({ findings: jsonResponse(500, { error: 'boom' }) })
    expect(await run({ falsePositive: true })).toBe(1)
    expect(stdout).toEqual([])
    routeFetch({ receipt: jsonResponse(503, { error: 'no secret' }) })
    expect(await run({ falsePositive: true })).toBe(1)
    expect(stdout).toEqual([])
    expect(writes()).toHaveLength(0)
  })

  it('an id not on the task is exit 1; no or both ruling flags is exit 1; an already-matching ruling is a no-op exit 0', async () => {
    expect(
      await findingDisposition('f-9', { falsePositive: true, task: 'LUM-750' })
    ).toBe(1)
    expect(stderr.join('\n')).toContain('not found on LUM-750')
    expect(await run({})).toBe(1)
    expect(await run({ falsePositive: true, acceptRisk: true })).toBe(1)
    routeFetch({
      findings: jsonResponse(200, {
        findings: [{ ...FINDING, disposition: 'FALSE_POSITIVE' }],
      }),
    })
    expect(await run({ falsePositive: true })).toBeUndefined()
    expect(stdout.join('')).toContain('already FALSE_POSITIVE — nothing to do')
    expect(writes()).toHaveLength(0)
  })
})

describe('finding disposition — --all-suggested-fp (bulk)', () => {
  beforeEach(() => {
    process.argv = [
      'node',
      'lumo',
      'finding',
      'disposition',
      '--all-suggested-fp',
      '--task',
      'LUM-750',
    ]
  })

  it('step 1: lists every suggested row in the envelope (and nothing else), exits 4, no write', async () => {
    const code = await findingDisposition(undefined, {
      allSuggestedFp: true,
      task: 'LUM-750',
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(writes()).toHaveLength(0)
    const env = envelope()
    expect(env.changes[0]).toBe(
      'Will disposition 2 security findings on LUM-750 as FALSE_POSITIVE — every undispositioned row the falsifier suggested as a false positive, and nothing else'
    )
    expect(env.changes).toContain(
      '  - f-1 [HIGH] EXTERNAL_TOOL ext:semgrep:sqli — lib/q.ts:40 — raw SQL built from request input — input is a parsed integer id'
    )
    expect(env.changes).toContain(
      '  - f-3 [MEDIUM] EXTERNAL_TOOL ext:semgrep:xss — app/x.tsx — unescaped output'
    )
    expect(env.changes.filter(l => l.startsWith('  - '))).toHaveLength(2)
    expect(env.confirmCommand).toBe(
      `lumo finding disposition --all-suggested-fp --task LUM-750 --receipt ${R1} --confirm-read`
    )
    // The finding list is not consulted — the receipt route is the source.
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).endsWith('/security-findings')
      )
    ).toBe(false)
  })

  it('step 2 + 3: acknowledge, then the bulk write with the stage-2 receipt', async () => {
    expect(
      await findingDisposition(undefined, {
        allSuggestedFp: true,
        task: 'LUM-750',
        confirmRead: true,
        receipt: R1,
      })
    ).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(
      envelope().confirmCommand.endsWith(`--receipt ${R2} --confirm`)
    ).toBe(true)
    expect(writes()).toHaveLength(0)
    stdout = []
    expect(
      await findingDisposition(undefined, {
        allSuggestedFp: true,
        task: 'LUM-750',
        confirm: true,
        receipt: R2,
      })
    ).toBeUndefined()
    const [url, init] = writes()[0] as [string, { body: string }]
    expect(url).toBe(
      'https://api.lumo.test/api/tasks/LUM-750/security-findings/bulk-disposition/cli'
    )
    expect(JSON.parse(init.body)).toEqual({
      disposition: 'FALSE_POSITIVE',
      scope: 'SUGGESTED',
      receipt: R2,
    })
    expect(stdout.join('')).toContain(
      '✓ Dispositioned 2 suggested findings on LUM-750 as FALSE_POSITIVE'
    )
  })

  it('nothing suggested (422 from the receipt route) is exit 1, no envelope', async () => {
    routeFetch({
      bulkReceipt: jsonResponse(422, {
        error:
          'No undispositioned finding on this task carries a suggested false-positive disposition',
      }),
    })
    expect(
      await findingDisposition(undefined, {
        allSuggestedFp: true,
        task: 'LUM-750',
      })
    ).toBe(1)
    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('No undispositioned finding')
  })

  it('refuses an id or a ruling flag alongside --all-suggested-fp', async () => {
    expect(
      await findingDisposition('f-1', { allSuggestedFp: true, task: 'LUM-750' })
    ).toBe(1)
    expect(
      await findingDisposition(undefined, {
        allSuggestedFp: true,
        falsePositive: true,
        task: 'LUM-750',
      })
    ).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('describeBulkDisposition: one line per row, the consequence line last', () => {
    const lines = describeBulkDisposition(SUGGESTED_ROWS, {
      taskIdentifier: 'LUM-1',
    })
    expect(lines).toHaveLength(4)
    expect(lines[3]).toContain("clears every listed finding's block")
  })
})

it('the command tree lists finding disposition with its flags (grammar in sync)', () => {
  const cmd = (
    grammarJson as {
      commands: Record<string, { flags: Record<string, unknown> }>
    }
  ).commands['finding disposition']
  expect(cmd).toBeDefined()
  for (const f of [
    '--false-positive',
    '--accept-risk',
    '--all-suggested-fp',
    '--note',
    '--task',
    '--receipt',
    '--confirm-read',
    '--confirm',
  ]) {
    expect(Object.keys(cmd?.flags ?? {})).toContain(f)
  }
})
