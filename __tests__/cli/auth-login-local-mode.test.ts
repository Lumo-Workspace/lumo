/**
 * @jest-environment node
 *
 * LUM-1335 — `lumo auth login [--url]`: a local-mode server issues the key
 * (nothing pasted); any other server falls back to the paste flow.
 */
const mockPrompt = jest.fn()
const mockOpen = jest.fn()
const mockWrite = jest.fn()
jest.mock('@/cli/src/lib/prompt', () => ({
  promptSecret: (...a: unknown[]) => mockPrompt(...a),
}))
jest.mock('@/cli/src/lib/browser', () => ({
  openBrowser: (...a: unknown[]) => mockOpen(...a),
}))
jest.mock('@/cli/src/lib/config', () => ({
  writeCredentials: (...a: unknown[]) => mockWrite(...a),
}))

import { authLogin } from '@/cli/src/commands/auth-login'

const VERIFY = {
  user: { id: 'user_1', email: 'local@lumo.localhost' },
  workspace: { id: 'ws1', slug: 'my-workspace', name: 'My workspace' },
  apiKey: {
    id: 'k1',
    name: 'lumo CLI (local mode)',
    prefix: 'lum_0123456789ab',
  },
}

type Handler = (url: string, init?: RequestInit) => Response
let calls: Array<{ url: string; method: string }>
function serve(handler: Handler) {
  calls = []
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET' })
      return handler(url, init)
    }
  ) as typeof fetch
}
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

let log: jest.SpyInstance
let err: jest.SpyInstance
const realFetch = global.fetch
beforeEach(() => {
  jest.resetAllMocks()
  log = jest.spyOn(console, 'log').mockImplementation(() => {})
  err = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  log.mockRestore()
  err.mockRestore()
  global.fetch = realFetch
})
const printed = () => log.mock.calls.map(c => c.join(' ')).join('\n')

describe('lumo auth login (LUM-1335)', () => {
  it('local mode: takes the issued key, never prompts or opens a browser, stores the --url', async () => {
    serve(url =>
      url.endsWith('/api/auth/lumo/local-cli-key')
        ? json({ key: 'lum_issued', workspaceSlug: 'my-workspace' }, 201)
        : json(VERIFY, 200)
    )
    await expect(
      authLogin({ url: 'http://localhost:3000/' })
    ).resolves.toBeUndefined()
    expect(calls).toEqual([
      {
        url: 'http://localhost:3000/api/auth/lumo/local-cli-key',
        method: 'POST',
      },
      { url: 'http://localhost:3000/api/auth/verify', method: 'GET' },
    ])
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'lum_issued',
        apiUrl: 'http://localhost:3000',
        workspaceSlug: 'my-workspace',
      })
    )
    expect(printed()).toContain('issued an API key for this machine')
    expect(printed()).toContain('  Server: local · http://localhost:3000')
  })

  it('any other server (404): the paste flow, unchanged', async () => {
    serve(url =>
      url.endsWith('/api/auth/lumo/local-cli-key')
        ? new Response('Not found', { status: 404 })
        : json(VERIFY, 200)
    )
    mockPrompt.mockResolvedValue('lum_pasted')
    await authLogin({ url: 'https://lumo.example.com' })
    expect(mockOpen).toHaveBeenCalledWith('https://lumo.example.com')
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'lum_pasted' })
    )
    expect(printed()).not.toContain('Local mode')
    expect(printed()).toContain(
      '  Server: self-hosted · https://lumo.example.com'
    )
  })

  it('a local-mode refusal is shown, then the paste flow runs', async () => {
    serve(url =>
      url.endsWith('/api/auth/lumo/local-cli-key')
        ? json(
            {
              error: 'local_mode_multiple_users',
              message: 'it has several accounts',
            },
            409
          )
        : json(VERIFY, 200)
    )
    mockPrompt.mockResolvedValue('lum_pasted')
    await authLogin({ url: 'http://localhost:3000' })
    expect(printed()).toContain(
      'Local mode did not issue a key: it has several accounts'
    )
    expect(mockPrompt).toHaveBeenCalled()
  })

  it.each([
    [
      'a 500 from any server',
      () => json({ error: 'Internal Server Error' }, 500),
    ],
    [
      'a 405 HTML page',
      () => new Response('<html>nope</html>', { status: 405 }),
    ],
    ['a 403 origin refusal', () => json({ code: 'INVALID_ORIGIN' }, 403)],
  ])(
    '%s is not reported as local mode: straight to the paste flow',
    async (_label, reply) => {
      serve(url =>
        url.endsWith('/api/auth/lumo/local-cli-key')
          ? reply()
          : json(VERIFY, 200)
      )
      mockPrompt.mockResolvedValue('lum_pasted')
      await authLogin({ url: 'https://lumo.example.com' })
      expect(printed()).not.toContain('Local mode')
      expect(mockPrompt).toHaveBeenCalled()
    }
  )

  it('names --url, not LUMO_API_URL, when the flag is not a URL', async () => {
    serve(() => json({}, 500))
    await expect(authLogin({ url: 'not a url' })).resolves.toBe(1)
    expect(calls).toEqual([])
    expect(err.mock.calls.join(' ')).toContain(
      '--url "not a url" is not a valid URL'
    )
  })

  it('refuses an insecure --url before sending anything', async () => {
    serve(() => json({}, 500))
    await expect(authLogin({ url: 'http://lumo.example.com' })).resolves.toBe(1)
    expect(calls).toEqual([])
    expect(err.mock.calls.join(' ')).toContain(
      'Refusing to use insecure API URL'
    )
  })

  it('--no-paste: a server that issues no key fails without prompting or opening a browser', async () => {
    serve(url =>
      url.endsWith('/api/auth/lumo/local-cli-key')
        ? new Response('Not found', { status: 404 })
        : json(VERIFY, 200)
    )
    await expect(
      authLogin({ url: 'http://localhost:3000', paste: false })
    ).resolves.toBe(1)
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
    expect(mockWrite).not.toHaveBeenCalled()
    expect(err.mock.calls.join(' ')).toContain('--no-paste is set')
  })

  it('--no-paste still logs in when the local-mode server issues a key', async () => {
    serve(url =>
      url.endsWith('/api/auth/lumo/local-cli-key')
        ? json({ key: 'lum_issued', workspaceSlug: 'my-workspace' }, 201)
        : json(VERIFY, 200)
    )
    await expect(
      authLogin({ url: 'http://localhost:3000', paste: false })
    ).resolves.toBeUndefined()
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'lum_issued' })
    )
  })

  it('a server that does not answer the key request in time: the paste flow', async () => {
    serve(() => json({}, 200))
    const timeout = Object.assign(
      new Error('The operation was aborted due to timeout'),
      {
        name: 'TimeoutError',
      }
    )
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/auth/lumo/local-cli-key')) throw timeout
      return json(VERIFY, 200)
    }) as typeof fetch
    mockPrompt.mockResolvedValue('lum_pasted')
    await authLogin({ url: 'https://lumo.example.com' })
    expect(mockPrompt).toHaveBeenCalled()
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'lum_pasted' })
    )
  })
})
