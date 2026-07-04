/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/browser', () => ({ openBrowser: jest.fn() }))

import {
  plan,
  planStatus,
  formatPlanDeepLink,
  stageLabel,
} from '@/cli/src/commands/plan'
import { readCredentials } from '@/cli/src/lib/config'
import { openBrowser } from '@/cli/src/lib/browser'

const mockCreds = readCredentials as jest.Mock
const mockOpen = openBrowser as jest.Mock

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Concatenated stdout across all writes this test. */
function stdout(): string {
  return writeSpy.mock.calls.map(c => c[0]).join('')
}

/** Body of the last fetch() POST, parsed. */
function lastPostBody(): Record<string, unknown> {
  const calls = (global.fetch as jest.Mock).mock.calls
  const call = calls[calls.length - 1]
  return JSON.parse((call[1] as RequestInit).body as string)
}

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
const OLD_API_URL = process.env.LUMO_API_URL

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })
  delete process.env.LUMO_API_URL
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn()
})

afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
  if (OLD_API_URL) process.env.LUMO_API_URL = OLD_API_URL
})

describe('formatPlanDeepLink', () => {
  it('builds the /workspace/<slug>/plan/<runId> URL', () => {
    expect(formatPlanDeepLink('https://api.test', 'lumo', 'run-9')).toBe(
      'https://api.test/workspace/lumo/plan/run-9'
    )
  })

  it('trims a trailing slash on the base', () => {
    expect(formatPlanDeepLink('https://api.test/', 'lumo', 'run-9')).toBe(
      'https://api.test/workspace/lumo/plan/run-9'
    )
  })
})

describe('stageLabel', () => {
  it('labels a known gate stage', () => {
    expect(stageLabel('CLUSTERS_READY')).toContain('gate A')
  })

  it('falls back to the raw enum for an unknown stage', () => {
    expect(stageLabel('SOME_FUTURE_STAGE')).toBe('SOME_FUTURE_STAGE')
  })
})

describe('lumo plan', () => {
  it('starts a run and prints (and opens) the gate-A deep-link', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { run: { id: 'run-1', stage: 'CLUSTERING' } })
    )

    const code = await plan({})

    expect(code).toBeUndefined()
    const call = (global.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe('https://api.test/api/plan-runs')
    expect((call[1] as RequestInit).method).toBe('POST')
    const link = 'https://api.test/workspace/lumo/plan/run-1'
    expect(stdout()).toContain(link)
    expect(mockOpen).toHaveBeenCalledWith(link)
  })

  it('does not send abandonActive unless the flag is set', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { run: { id: 'run-1', stage: 'CLUSTERING' } })
    )

    await plan({})

    expect('abandonActive' in lastPostBody()).toBe(false)
  })

  it('--abandon-active abandons the prior run then starts a new one', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(201, { run: { id: 'run-2', stage: 'CLUSTERING' } })
    )

    const code = await plan({ abandonActive: true })

    expect(code).toBeUndefined()
    expect(lastPostBody().abandonActive).toBe(true)
    expect(stdout()).toContain('run-2')
  })

  it('refuses when a run is already active (409) and points to status', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(409, { error: 'An active plan run already exists' })
    )

    const code = await plan({})

    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('lumo plan status')
    )
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('--abandon-active')
    )
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('reports an auth failure without opening a browser', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(401, { error: 'unauthorized' })
    )

    const code = await plan({})

    expect(code).toBe(1)
    expect(mockOpen).not.toHaveBeenCalled()
  })
})

describe('lumo plan status', () => {
  it('plan status prints stage and next deep-link', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(200, { run: { id: 'run-7', stage: 'ALIGNMENT_READY' } })
    )

    const code = await planStatus()

    expect(code).toBeUndefined()
    const call = (global.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toBe('https://api.test/api/plan-runs/active')
    const out = stdout()
    expect(out).toContain('run-7')
    expect(out).toContain('gate B')
    expect(out).toContain('https://api.test/workspace/lumo/plan/run-7')
  })

  it('prompts to run `lumo plan` when there is no active run', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(200, { run: null })
    )

    const code = await planStatus()

    expect(code).toBeUndefined()
    expect(stdout()).toContain('lumo plan')
  })

  it('reports a server error (non-ok, non-401)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(404, { error: 'No default team for workspace' })
    )

    const code = await planStatus()

    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('No default team for workspace')
    )
  })
})
