/**
 * @jest-environment node
 *
 * LUM-1332 — checkRealtimeConnection: one signed GET /channels; never throws.
 */
const getMock = jest.fn()
jest.mock('pusher', () => jest.fn().mockImplementation(() => ({ get: getMock })))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}))

type ServerModule = typeof import('@/lib/integrations/pusher/server')

const ENV_KEYS = ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER', 'PUSHER_HOST']

function loadWith(env: Record<string, string>): ServerModule {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, env)
  let mod: ServerModule | undefined
  jest.isolateModules(() => {
    mod = require('@/lib/integrations/pusher/server')
  })
  return mod!
}

const SOKETI = {
  PUSHER_APP_ID: 'lumo',
  PUSHER_KEY: 'lumo',
  PUSHER_SECRET: ['soketi', 'fixture'].join('-'),
  PUSHER_HOST: 'soketi',
}

beforeEach(() => getMock.mockReset())
afterAll(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('checkRealtimeConnection', () => {
  it('not configured: no request', async () => {
    expect(await loadWith({}).checkRealtimeConnection()).toEqual({ status: 'not_configured' })
    expect(getMock).not.toHaveBeenCalled()
  })

  it('ok on HTTP 200 from GET /channels', async () => {
    getMock.mockResolvedValue({ status: 200 })
    expect(await loadWith(SOKETI).checkRealtimeConnection()).toEqual({ status: 'ok' })
    expect(getMock).toHaveBeenCalledWith({ path: '/channels' })
  })

  it('a rejected signature or an unreachable server is a failure, not a throw', async () => {
    const m = loadWith(SOKETI)
    getMock.mockRejectedValueOnce(Object.assign(new Error('Unexpected status'), { status: 401 }))
    expect(await m.checkRealtimeConnection()).toEqual({ status: 'failed', message: 'HTTP 401' })
    getMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND soketi'))
    expect(await m.checkRealtimeConnection()).toEqual({
      status: 'failed',
      message: 'getaddrinfo ENOTFOUND soketi',
    })
  })
})
