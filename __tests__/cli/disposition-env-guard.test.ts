/**
 * @jest-environment node
 *
 * LUM-750 — `lumo crossing disposition` and `lumo finding disposition` record
 * the USER's ruling and are refused inside an agent session: the LUM-769
 * handshake cannot prove a human ticked each step when an agent relays them.
 * Either Claude Code marker (CLAUDE_CODE_SESSION_ID / CLAUDECODE) refuses
 * before any request; a plain terminal walks the handshake with --task.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import { crossingDisposition } from '@/cli/src/commands/crossing-disposition'
import { findingDisposition } from '@/cli/src/commands/finding-disposition'
import {
  AGENT_SESSION_ENV_VARS,
  agentSessionRefusal,
  insideAgentSession,
} from '@/cli/src/lib/agent-env-guard'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'

const SAVED: Record<string, string | undefined> = {}
let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]

beforeEach(() => {
  for (const k of AGENT_SESSION_ENV_VARS) {
    SAVED[k] = process.env[k]
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
  fetchMock = jest.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith('/security-findings') && !init?.method) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          findings: [
            {
              id: 'f-1',
              ruleId: 'secret:aws-access-key-id',
              severity: 'HIGH',
              provenance: 'DETERMINISTIC',
              filePath: 'lib/cfg.ts',
              line: 12,
              title: 'AWS access key id',
              prNumber: 12,
              disposition: null,
              blocking: true,
              persisting: false,
              queueExit: null,
              suggestedDisposition: null,
              suggestedReason: null,
            },
          ],
        }),
      }
    }
    if (url.endsWith('/boundary-crossings') && !init?.method) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          crossings: [
            {
              id: 'cx-1',
              category: 'HOOK_BYPASS',
              severity: 'MEDIUM',
              detail: 'git commit -n',
              disposition: null,
            },
          ],
        }),
      }
    }
    if (url.endsWith('/disposition/receipt')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          receipt: 'r1.1.2.sig',
          stage: 'READ',
          expiresAt: '2026-09-14T10:10:00.000Z',
          readAt: '2026-09-14T10:00:00.000Z',
          readAcknowledgedAt: null,
        }),
      }
    }
    throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
  for (const k of AGENT_SESSION_ENV_VARS) {
    if (SAVED[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED[k]
  }
})

describe('insideAgentSession', () => {
  it('is false with no marker, true with either marker', () => {
    expect(insideAgentSession({})).toBe(false)
    expect(insideAgentSession({ CLAUDE_CODE_SESSION_ID: 'sess-1' })).toBe(true)
    expect(insideAgentSession({ CLAUDECODE: '1' })).toBe(true)
    expect(insideAgentSession({ CLAUDECODE: '' })).toBe(false)
  })

  it('the refusal names the command for the user to run with --task and the SELF_DISPOSITION consequence', () => {
    const text = agentSessionRefusal(
      'lumo finding disposition f-1 --false-positive'
    )
    expect(text).toContain('refused inside an agent session')
    expect(text).toContain(
      'lumo finding disposition f-1 --false-positive --task <LUM-N>'
    )
    expect(text).toContain('SELF_DISPOSITION')
  })
})

describe('environment guard — crossing disposition', () => {
  it.each(AGENT_SESSION_ENV_VARS)(
    'refuses with exit 1, no request and no envelope when %s is set',
    async marker => {
      process.env[marker] = marker === 'CLAUDECODE' ? '1' : 'sess-1'
      const code = await crossingDisposition('cx-1', {
        falsePositive: true,
        task: 'LUM-750',
      })
      expect(code).toBe(1)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(stdout).toEqual([])
      const err = stderr.join('\n')
      expect(err).toContain('refused inside an agent session')
      expect(err).toContain(
        'lumo crossing disposition cx-1 --false-positive | --confirmed --task <LUM-N>'
      )
      expect(err).toContain('SELF_DISPOSITION')
    }
  )

  it('in a plain terminal the handshake proceeds with the task from --task (exit 4 envelope, stage-1 receipt)', async () => {
    process.argv = [
      'node',
      'lumo',
      'crossing',
      'disposition',
      'cx-1',
      '--false-positive',
      '--task',
      'LUM-750',
    ]
    const code = await crossingDisposition('cx-1', {
      falsePositive: true,
      task: 'LUM-750',
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = JSON.parse(stdout.join('')) as { confirmCommand: string }
    expect(env.confirmCommand).toContain('--task LUM-750')
    expect(env.confirmCommand.endsWith('--confirm-read')).toBe(true)
    // No session header — a plain terminal has no session.
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ]
    expect(init.headers['X-Lumo-Session-Id']).toBeUndefined()
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes('/api/sessions/'))
    ).toBe(false)
  })
})

describe('environment guard — finding disposition', () => {
  it.each(AGENT_SESSION_ENV_VARS)(
    'refuses with exit 1, no request and no envelope when %s is set (single and bulk)',
    async marker => {
      process.env[marker] = marker === 'CLAUDECODE' ? '1' : 'sess-1'
      expect(
        await findingDisposition('f-1', {
          falsePositive: true,
          task: 'LUM-750',
        })
      ).toBe(1)
      expect(
        await findingDisposition(undefined, {
          allSuggestedFp: true,
          task: 'LUM-750',
        })
      ).toBe(1)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(stdout).toEqual([])
      const err = stderr.join('\n')
      expect(err).toContain(
        'lumo finding disposition f-1 --false-positive | --accept-risk --task <LUM-N>'
      )
      expect(err).toContain(
        'lumo finding disposition --all-suggested-fp --task <LUM-N>'
      )
      expect(err).toContain('SELF_DISPOSITION')
    }
  )

  it('in a plain terminal the handshake proceeds with the task from --task', async () => {
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
    const code = await findingDisposition('f-1', {
      falsePositive: true,
      task: 'LUM-750',
    })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = JSON.parse(stdout.join('')) as { confirmCommand: string }
    expect(env.confirmCommand).toBe(
      'lumo finding disposition f-1 --false-positive --task LUM-750 --receipt r1.1.2.sig --confirm-read'
    )
  })

  it('without --task in a plain terminal it is refused before any read (no binding to fall back on)', async () => {
    const code = await findingDisposition('f-1', { falsePositive: true })
    expect(code).toBe(1)
    expect(stderr.join('\n')).toContain('--task')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
