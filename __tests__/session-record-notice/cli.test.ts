/**
 * @jest-environment node
 *
 * LUM-943 — the CLI side of the session record notice: the session-start hook
 * injects the server-rendered line (bound or not), and `lumo setup` fetches
 * and prints it — silently skipping whenever it cannot get it.
 */
import {
  formatHookStdoutLines,
  resolveSessionStartStdout,
} from '@/cli/src/lib/hook-runner'
import { fetchSessionRecordNotice } from '@/cli/src/lib/session-record-notice'
import { printSessionRecordNotice } from '@/cli/src/commands/init'
import type { Credentials } from '@/cli/src/lib/config'

const NOTICE =
  'Session records in this workspace: kept forever, including code and command output; credentials are always redacted. An OWNER can change this in Settings → Data retention: https://www.uselumo.ai/workspace/acme/settings/workspace#data-retention'

const CREDS: Credentials = {
  token: 'lum_test_token',
  apiUrl: 'https://www.uselumo.ai',
  email: 'a@b.test',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
  apiKeyName: 'laptop',
  apiKeyPrefix: 'lum_tes',
} as Credentials

function contextOf(lines: string[]): string | null {
  const json = lines.find(l => l.startsWith('{'))
  if (!json) return null
  return (
    JSON.parse(json) as { hookSpecificOutput: { additionalContext: string } }
  ).hookSpecificOutput.additionalContext
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('LUM-943 session record notice (CLI)', () => {
  const savedEnv = process.env.LUMO_API_URL
  beforeEach(() => {
    delete process.env.LUMO_API_URL
  })
  afterAll(() => {
    if (savedEnv === undefined) delete process.env.LUMO_API_URL
    else process.env.LUMO_API_URL = savedEnv
  })

  it('LUM-943 session-start bound: the notice is injected last in the additionalContext', () => {
    const lines = formatHookStdoutLines('session-start', {
      sessionId: 's-1',
      taskBinding: { bound: true, taskIdentifier: 'LUM-1', taskTitle: 't' },
      testCaseSection: '## Test cases',
      sessionRecordNotice: NOTICE,
    })
    const ctx = contextOf(lines)!
    expect(ctx).toContain(NOTICE)
    expect(ctx.indexOf('## Test cases')).toBeLessThan(ctx.indexOf(NOTICE))
  })

  it('LUM-943 session-start unbound: the notice is injected after the status line, with or without a git match', () => {
    const noMatch = resolveSessionStartStdout(
      {
        sessionId: 's-1',
        taskBinding: { bound: false },
        sessionRecordNotice: NOTICE,
      },
      { extractTask: () => null }
    )
    expect(noMatch[0]).toContain('No task bound')
    expect(contextOf(noMatch)).toBe(NOTICE)

    const match = resolveSessionStartStdout(
      {
        sessionId: 's-1',
        taskBinding: { bound: false },
        sessionRecordNotice: NOTICE,
      },
      { extractTask: () => ({ identifier: 'LUM-42', source: 'branch' }) }
    )
    expect(match[0]).toContain('Detected LUM-42')
    expect(contextOf(match)).toBe(NOTICE)
  })

  it('LUM-943 session-start skip: no notice from an older server or a failed lookup adds nothing', () => {
    for (const notice of [undefined, '', '   ']) {
      const unbound = resolveSessionStartStdout(
        {
          sessionId: 's-1',
          taskBinding: { bound: false },
          sessionRecordNotice: notice,
        },
        { extractTask: () => null }
      )
      expect(unbound).toHaveLength(1)
      const bound = formatHookStdoutLines('session-start', {
        sessionId: 's-1',
        taskBinding: { bound: true, taskIdentifier: 'LUM-1', taskTitle: 't' },
        sessionRecordNotice: notice,
      })
      expect(bound).toHaveLength(1)
    }
  })

  it('LUM-943 session-start sanitize: control characters in the notice are stripped', () => {
    const lines = resolveSessionStartStdout(
      {
        sessionId: 's-1',
        taskBinding: { bound: false },
        sessionRecordNotice: 'Session records\u001b[31m here',
      },
      { extractTask: () => null }
    )
    expect(contextOf(lines)).toBe('Session records[31m here')
  })

  it('LUM-943 setup fetch: GETs session-records with the bearer token and returns the notice', async () => {
    const fetchMock = jest.fn(async () =>
      okResponse({
        sessionRecords: { mode: 'RETAIN', days: null, notice: NOTICE },
      })
    )
    const notice = await fetchSessionRecordNotice({
      readCredentials: () => CREDS,
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(notice).toBe(NOTICE)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://www.uselumo.ai/api/workspaces/me/session-records')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer lum_test_token'
    )
  })

  it('LUM-943 setup fetch skip: not logged in, non-2xx, network error, null body or a timeout all yield null', async () => {
    const neverCalled = jest.fn()
    await expect(
      fetchSessionRecordNotice({
        readCredentials: () => null,
        fetch: neverCalled as unknown as typeof fetch,
      })
    ).resolves.toBeNull()
    expect(neverCalled).not.toHaveBeenCalled()

    const cases: Array<() => Promise<Response>> = [
      async () => new Response('Not found', { status: 404 }),
      async () => {
        throw new Error('ECONNREFUSED')
      },
      async () => okResponse({ sessionRecords: null }),
      async () => new Response('not json', { status: 200 }),
    ]
    for (const impl of cases) {
      await expect(
        fetchSessionRecordNotice({
          readCredentials: () => CREDS,
          fetch: jest.fn(impl) as unknown as typeof fetch,
        })
      ).resolves.toBeNull()
    }

    const hanging = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        })
    )
    await expect(
      fetchSessionRecordNotice({
        readCredentials: () => CREDS,
        fetch: hanging as unknown as typeof fetch,
        timeoutMs: 10,
      })
    ).resolves.toBeNull()
  })

  it('LUM-943 setup fetch skip: an insecure LUMO_API_URL is refused without sending the token', async () => {
    process.env.LUMO_API_URL = 'http://evil.example.com'
    const fetchMock = jest.fn()
    await expect(
      fetchSessionRecordNotice({
        readCredentials: () => CREDS,
        fetch: fetchMock as unknown as typeof fetch,
      })
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('LUM-943 setup print: prints the notice line, and prints nothing when it is unavailable', async () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    try {
      await printSessionRecordNotice(async () => NOTICE)
      expect(write).toHaveBeenCalledWith(`\nℹ ${NOTICE}\n`)

      write.mockClear()
      await printSessionRecordNotice(async () => null)
      await printSessionRecordNotice(async () => {
        throw new Error('boom')
      })
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
  })
})
