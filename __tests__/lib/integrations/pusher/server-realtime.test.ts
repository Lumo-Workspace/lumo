/**
 * @jest-environment node
 */
const ctor = jest.fn()
const triggerMock = jest.fn()
jest.mock('pusher', () =>
  jest.fn().mockImplementation((opts: unknown) => {
    ctor(opts)
    return { trigger: triggerMock }
  })
)
const logInfo = jest.fn()
const logError = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => logInfo(...a),
    error: (...a: unknown[]) => logError(...a),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}))

type ServerModule = typeof import('@/lib/integrations/pusher/server')

const ENV_KEYS = [
  'PUSHER_APP_ID',
  'PUSHER_KEY',
  'PUSHER_SECRET',
  'PUSHER_CLUSTER',
  'PUSHER_HOST',
  'PUSHER_PORT',
  'PUSHER_USE_TLS',
]

function loadWith(env: Record<string, string>): ServerModule {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, env)
  let mod: ServerModule | undefined
  jest.isolateModules(() => {
    mod = require('@/lib/integrations/pusher/server')
  })
  return mod!
}

beforeEach(() => {
  ctor.mockReset()
  triggerMock.mockReset().mockResolvedValue({})
  logInfo.mockReset()
  logError.mockReset()
})

describe('server realtime wrapper', () => {
  it('unconfigured: every push is a no-op that resolves, logs once, never builds a client', async () => {
    const m = loadWith({})
    await expect(
      m.pushTaskEvent('t1', { type: 'comment:created', commentId: 'c' })
    ).resolves.toBeUndefined()
    await m.pushUserEvent('u1', { type: 'notification:new' })
    m.fireAgentEvent('t1', { type: 'agent:progress', message: 'x' })
    expect(m.isServerRealtimeConfigured()).toBe(false)
    expect(ctor).not.toHaveBeenCalled()
    expect(triggerMock).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it('cloud: builds the client with cluster + TLS (unchanged SaaS behaviour)', async () => {
    const m = loadWith({
      PUSHER_APP_ID: 'a',
      PUSHER_KEY: 'k',
      PUSHER_SECRET: 's',
      PUSHER_CLUSTER: 'us2',
    })
    await m.pushProjectEvent('p1', {
      type: 'task:updated',
      taskId: 't',
      fields: ['status'],
    })
    expect(ctor).toHaveBeenCalledWith({
      appId: 'a',
      key: 'k',
      secret: 's',
      cluster: 'us2',
      useTLS: true,
    })
    expect(triggerMock).toHaveBeenCalledWith(
      'project-p1',
      'project-update',
      expect.objectContaining({ taskId: 't' })
    )
  })

  it('custom host (Soketi): passes host/port/useTLS, no cluster', async () => {
    const m = loadWith({
      PUSHER_APP_ID: 'a',
      PUSHER_KEY: 'k',
      PUSHER_SECRET: 's',
      PUSHER_HOST: '127.0.0.1',
      PUSHER_PORT: '6001',
      PUSHER_USE_TLS: 'false',
    })
    await m.pushDocumentEvent('d1', {
      type: 'comment:created',
      commentId: 'c',
    } as never)
    expect(ctor).toHaveBeenCalledWith({
      appId: 'a',
      key: 'k',
      secret: 's',
      host: '127.0.0.1',
      port: '6001',
      useTLS: false,
    })
    expect(triggerMock).toHaveBeenCalledWith(
      'document-d1',
      'document-update',
      expect.anything()
    )
  })

  it('a failing trigger is logged, not thrown', async () => {
    const m = loadWith({
      PUSHER_APP_ID: 'a',
      PUSHER_KEY: 'k',
      PUSHER_SECRET: 's',
      PUSHER_CLUSTER: 'us2',
    })
    triggerMock.mockRejectedValueOnce(new Error('boom'))
    await expect(
      m.pushActivityEvent('t1', { action: 'created' })
    ).resolves.toBeUndefined()
    expect(logError).toHaveBeenCalledTimes(1)
  })
})

export {}
