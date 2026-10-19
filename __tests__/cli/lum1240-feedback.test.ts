/**
 * @jest-environment node
 *
 * LUM-1240: `lumo feedback create | list | show` — local validation (exit 2),
 * the whitelisted environment block and `--no-env`, the last-command record
 * (names only, never values), the rate-limit error (exit 1 + hint), list /
 * show rendering, and the RATE_LIMITED --json error code.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'acme',
    email: 'me@x.com',
  })),
}))
jest.mock('@/cli/src/lib/session-id', () => ({
  resolveSessionId: jest.fn(async () => 'sess-123'),
}))

import {
  buildPayload,
  createErrorLines,
  feedbackCreate,
  feedbackList,
  feedbackShow,
  formatFeedbackDetail,
  formatFeedbackList,
  listQuery,
  validateCreateOptions,
} from '@/cli/src/commands/feedback'
import {
  collectFeedbackEnv,
  detectAgentHost,
  FEEDBACK_ENV_KEYS,
  formatEnvSummary,
} from '@/cli/src/lib/feedback-env'
import {
  buildLastCommand,
  readLastCommand,
  recordLastCommand,
  sessionKey,
} from '@/cli/src/lib/last-command'
import { classifyError } from '@/cli/src/lib/error-output'
import { feedbackEnvironmentSchema } from '@/lib/validation/feedback'

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>
let tmp: string
const savedEnv = { ...process.env }

function serve(body: unknown, status = 200) {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lum1240-'))
  process.env = { ...savedEnv, LUMO_CONFIG_DIR: tmp, LUMO_NO_HINTS: '' }
  delete process.env.CODEX_THREAD_ID
  delete process.env.CODEX_SESSION_ID
  process.env.CLAUDE_CODE_SESSION_ID = 'cc-session'
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((s: unknown) => {
    out += `${String(s)}\n`
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += `${String(s)}\n`
  })
})
afterEach(() => {
  jest.restoreAllMocks()
  process.env = { ...savedEnv }
  fs.rmSync(tmp, { recursive: true, force: true })
})

const detail = {
  feedback: {
    ref: 'FB-3',
    id: 'cfb3',
    kind: 'BUG',
    status: 'NEW',
    title: 'upload fails',
    steps: ['run lumo task testcase run', 'see 413'],
    expected: 'upload works',
    actual: 'Error: 413',
    evidence: [
      {
        url: 'https://api.lumo.test/api/files/workspaces/w1/feedback/f1',
        filename: 'shot.png',
        contentType: 'image/png',
        size: 2048,
      },
    ],
    environment: null,
    task: 'LUM-7',
    sessionId: 'sess-123',
    submittedBy: { name: 'Ada' },
    secretsRedacted: 1,
    createdAt: '2026-10-19T02:00:00.000Z',
    updatedAt: '2026-10-19T02:00:00.000Z',
    statusChangedAt: null,
  },
  replies: [
    {
      body: 'Reproduced, fix ships next.',
      author: 'Lumo team',
      createdAt: '2026-10-19T03:00:00.000Z',
    },
  ],
}

function payloadOf(call: {
  init: RequestInit | undefined
}): Record<string, unknown> {
  const fd = call.init?.body as FormData
  return JSON.parse(String(fd.get('payload'))) as Record<string, unknown>
}

describe('lumo feedback create', () => {
  it('rejects invalid flags locally with exit 2 (no request)', async () => {
    serve(detail, 201)
    expect(validateCreateOptions({ title: 'x', kind: 'rant' })).toMatch(
      /--kind/
    )
    expect(validateCreateOptions({ title: 'x'.repeat(201) })).toMatch(/--title/)
    expect(
      validateCreateOptions({
        title: 'x',
        evidenceFile: ['a', 'b', 'c', 'd', 'e', 'f'].map(n => `${n}.png`),
      })
    ).toMatch(/at most 5/)
    expect(
      validateCreateOptions({ title: 'x', evidenceFile: ['a.pdf'] })
    ).toMatch(/unsupported/)
    expect(validateCreateOptions({ title: 'x', task: 'not a ref' })).toMatch(
      /--task/
    )
    expect(await feedbackCreate({ title: 'x', kind: 'rant' })).toBe(2)
    expect(calls).toHaveLength(0)
  })

  it('sends the whitelisted environment and the session ref by default', async () => {
    recordLastCommand(buildLastCommand('task show', ['--full'], 1, new Date()))
    serve(detail, 201)
    expect(
      await feedbackCreate({
        title: 'upload fails',
        step: ['a'],
        task: 'lum-7',
      })
    ).toBeUndefined()
    const p = payloadOf(calls[0]!)
    expect(p.task).toBe('LUM-7')
    const env = p.environment as Record<string, unknown>
    expect(Object.keys(env).sort()).toEqual([...FEEDBACK_ENV_KEYS].sort())
    expect(env.lastCommand).toMatchObject({
      command: 'task show',
      flags: ['--full'],
      exitCode: 1,
    })
    expect(env.agentHost).toBe('CLAUDE_CODE')
    // The server's strict schema accepts exactly what the CLI sends.
    expect(feedbackEnvironmentSchema.safeParse(env).success).toBe(true)
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers['X-Lumo-Session-Id']).toBe('sess-123')
    expect(out).toContain('Created feedback FB-3 "upload fails"')
    expect(out).toContain('Sent env:')
    expect(out).toContain(
      'Note: 1 suspected secret was redacted before saving.'
    )
  })

  it('--no-env sends no environment and no session header', async () => {
    serve(detail, 201)
    await feedbackCreate({ title: 'upload fails', env: false })
    const p = payloadOf(calls[0]!)
    expect('environment' in p).toBe(false)
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers['X-Lumo-Session-Id']).toBeUndefined()
    expect(out).toMatch(/Sent env: +- \(disabled with --no-env\)/)
    expect(buildPayload({ title: 't' }, null)).not.toHaveProperty('environment')
  })

  it('uploads evidence files as file parts with their type', async () => {
    const f = path.join(tmp, 'log.txt')
    fs.writeFileSync(f, 'boom')
    serve(detail, 201)
    await feedbackCreate({ title: 't', evidenceFile: [f], env: false })
    const fd = calls[0]!.init?.body as FormData
    const file = fd.getAll('file')[0] as File
    expect(file.name).toBe('log.txt')
    expect(file.type).toBe('text/plain')
  })

  it('an unreadable evidence file exits 1 before any request', async () => {
    serve(detail, 201)
    expect(
      await feedbackCreate({
        title: 't',
        evidenceFile: [path.join(tmp, 'nope.png')],
      })
    ).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('over the limit: exit 1 with the limit, the retry time and a hint', async () => {
    serve(
      {
        error: 'feedback limit reached for this workspace (50 per 24 h)',
        code: 'RATE_LIMITED',
        scope: 'workspace',
        window: 'daily',
        limit: 50,
        retryAt: '2026-10-20T01:14:00.000Z',
      },
      429
    )
    expect(await feedbackCreate({ title: 't' })).toBe(1)
    expect(err).toMatch(
      /^Error: feedback limit reached for this workspace \(50 per 24 h\); you can send more after \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}$/m
    )
    expect(err).toContain(
      'Hint: add details to an existing report instead (`lumo feedback list --mine`)'
    )
    expect(
      classifyError(
        1,
        'feedback limit reached for this workspace (50 per 24 h)'
      )
    ).toBe('RATE_LIMITED')
  })

  it('maps a 413 to a clear error', () => {
    expect(createErrorLines(413, null)[0]).toBe(
      'Error: evidence too large for one request (HTTP 413)'
    )
  })

  it('--json prints the detail envelope', async () => {
    serve(detail, 201)
    await feedbackCreate({ title: 't', env: false, json: true })
    const body = JSON.parse(out) as Record<string, unknown>
    expect(body).toMatchObject({
      version: 1,
      feedback: { ref: 'FB-3' },
      replies: [{ author: 'Lumo team' }],
    })
  })
})

describe('environment block', () => {
  it('detects the agent host from the presence of its session variable only', () => {
    expect(detectAgentHost({ CLAUDE_CODE_SESSION_ID: 'x' })).toBe('CLAUDE_CODE')
    expect(
      detectAgentHost({ CODEX_THREAD_ID: 't', CLAUDE_CODE_SESSION_ID: 'x' })
    ).toBe('CODEX')
    expect(detectAgentHost({})).toBeNull()
  })

  it('contains exactly the whitelisted keys and nothing from cwd / user / host', () => {
    const env = collectFeedbackEnv({
      cliVersion: '1.126.0',
      lastCommand: null,
      env: {},
    })
    expect(Object.keys(env).sort()).toEqual([...FEEDBACK_ENV_KEYS].sort())
    const text = JSON.stringify(env)
    expect(text).not.toContain(process.cwd())
    expect(text).not.toContain(os.hostname())
    expect(text).not.toContain(os.userInfo().username)
    expect(
      collectFeedbackEnv({
        cliVersion: 'not-a-version',
        lastCommand: null,
        env: {},
      }).cliVersion
    ).toBeNull()
    expect(formatEnvSummary(env)).toContain('cli 1.126.0')
  })
})

describe('last-command record', () => {
  it('keeps the command path, flag names and exit code — never values', () => {
    const e = buildLastCommand(
      'task update',
      ['--title', '--title=sk-secret', 'sk-secret', '--status'],
      1,
      new Date('2026-10-19T00:00:00Z')
    )
    expect(e).toEqual({
      command: 'task update',
      flags: ['--title', '--status'],
      exitCode: 1,
      at: '2026-10-19T00:00:00Z',
    })
    expect(buildLastCommand('hook post-tool-use', [], 0, new Date())).toBeNull()
    expect(buildLastCommand('feedback create', [], 0, new Date())).toBeNull()
    expect(buildLastCommand('task show LUM-1', [], 0, new Date())).toBeNull()
  })

  it('is stored per agent session and expires after an hour', () => {
    const now = new Date()
    recordLastCommand(buildLastCommand('task show', [], 1, now))
    expect(readLastCommand(process.env, now)?.command).toBe('task show')
    expect(sessionKey({ CODEX_THREAD_ID: 'th' })).toBe('th')
    expect(
      readLastCommand({ ...process.env, CLAUDE_CODE_SESSION_ID: 'other' }, now)
    ).toBeNull()
    expect(
      readLastCommand(process.env, new Date(now.getTime() + 61 * 60_000))
    ).toBeNull()
    const raw = fs.readFileSync(path.join(tmp, 'last-command.json'), 'utf8')
    expect(raw).not.toMatch(/LUM-|secret/)
  })
})

describe('lumo feedback list / show', () => {
  const list = {
    feedback: [
      {
        ref: 'FB-3',
        id: 'c3',
        kind: 'BUG',
        status: 'TRIAGED',
        title: 'upload\tfails',
        replyCount: 1,
        submittedBy: { name: 'Ada' },
        createdAt: '2026-10-19T02:00:00.000Z',
      },
    ],
    total: 3,
    nextCursor: '3',
  }

  it('validates filters locally (exit 2) and builds the query', async () => {
    expect(listQuery({ status: 'Triaged', mine: true, limit: '10' })).toBe(
      '?status=TRIAGED&mine=true&limit=10'
    )
    expect(listQuery({ status: 'open' })).toEqual({
      error: expect.stringMatching(/--status/),
    })
    serve(list)
    expect(await feedbackList({ kind: 'rant' })).toBe(2)
    expect(calls).toHaveLength(0)
  })

  it('renders the list: ref first, tab-separated in a pipe, paging footer', async () => {
    expect(formatFeedbackList(list.feedback, { tty: false })).toBe(
      'FB-3\tBUG\tTRIAGED\t1\t2026-10-19T02:00:00Z\tAda\tupload fails'
    )
    serve(list)
    await feedbackList({})
    expect(calls[0]!.url).toBe('https://api.lumo.test/api/feedback')
    expect(out).toContain('Showing 1 of 3.')
    expect(out).toContain('Next page: lumo feedback list --cursor 3')
  })

  it('--json list envelope', async () => {
    serve(list)
    await feedbackList({ json: true })
    expect(JSON.parse(out)).toMatchObject({
      version: 1,
      feedback: [{ ref: 'FB-3' }],
      total: 3,
      nextCursor: '3',
    })
  })

  it('show renders sections and replies signed "Lumo team"', () => {
    const text = formatFeedbackDetail(detail, { tty: false })
    expect(text.split('\n')[0]).toBe('FB-3  upload fails')
    expect(text).toContain('  1. run lumo task testcase run')
    expect(text).toContain('shot.png  image/png  2.0 KB')
    expect(text).toContain('  - (not sent: --no-env)')
    expect(text).toContain('Lumo team')
    expect(text).toContain('    Reproduced, fix ships next.')
  })

  it('show of a report outside the workspace: exit 1, not-found with a hint', async () => {
    serve({ error: 'feedback FB-9 not found' }, 404)
    expect(await feedbackShow('fb-9', {})).toBe(1)
    expect(calls[0]!.url).toBe('https://api.lumo.test/api/feedback/FB-9')
    expect(err).toContain('Error: feedback FB-9 not found in workspace acme')
    expect(err).toContain('Hint: list feedback with `lumo feedback list`.')
    expect(await feedbackShow('LUM-9', {})).toBe(2)
  })
})
