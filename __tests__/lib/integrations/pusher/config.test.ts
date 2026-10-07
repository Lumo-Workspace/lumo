import {
  isClientRealtimeConfigured,
  parseUseTLS,
  readClientPusherEnv,
  readServerPusherEnv,
  resolveClientPusherConfig,
  resolveServerPusherConfig,
} from '@/lib/integrations/pusher/config'

const CREDS = { PUSHER_APP_ID: 'app', PUSHER_KEY: 'key', PUSHER_SECRET: 'sec' }

describe('parseUseTLS', () => {
  it('defaults to the fallback when unset or blank', () => {
    expect(parseUseTLS(undefined)).toBe(true)
    expect(parseUseTLS('  ')).toBe(true)
    expect(parseUseTLS(undefined, false)).toBe(false)
  })
  it.each(['false', 'FALSE', '0', 'no', 'off'])('treats %s as off', v => {
    expect(parseUseTLS(v)).toBe(false)
  })
  it.each(['true', '1', 'yes'])('treats %s as on', v => {
    expect(parseUseTLS(v)).toBe(true)
  })
})

describe('resolveServerPusherConfig', () => {
  it('cloud: cluster without host keeps the current Pusher behaviour (TLS on)', () => {
    expect(
      resolveServerPusherConfig({ ...CREDS, PUSHER_CLUSTER: 'us2' })
    ).toEqual({
      mode: 'cloud',
      appId: 'app',
      key: 'key',
      secret: 'sec',
      cluster: 'us2',
      useTLS: true,
    })
  })

  it('custom host: host/port/TLS from env, cluster ignored', () => {
    expect(
      resolveServerPusherConfig({
        ...CREDS,
        PUSHER_CLUSTER: 'us2',
        PUSHER_HOST: 'soketi.internal',
        PUSHER_PORT: '6001',
        PUSHER_USE_TLS: 'false',
      })
    ).toEqual({
      mode: 'custom',
      appId: 'app',
      key: 'key',
      secret: 'sec',
      host: 'soketi.internal',
      port: '6001',
      useTLS: false,
    })
  })

  it('custom host: invalid port is dropped, TLS defaults on', () => {
    const cfg = resolveServerPusherConfig({
      ...CREDS,
      PUSHER_HOST: 'rt.example.com',
      PUSHER_PORT: 'abc',
    })
    expect(cfg).toEqual({
      mode: 'custom',
      appId: 'app',
      key: 'key',
      secret: 'sec',
      host: 'rt.example.com',
      useTLS: true,
    })
  })

  it('unconfigured: no credentials → null', () => {
    expect(resolveServerPusherConfig({})).toBeNull()
    expect(
      resolveServerPusherConfig({ PUSHER_CLUSTER: 'us2', PUSHER_KEY: 'k' })
    ).toBeNull()
  })

  it('unconfigured: blank strings (env.example copied as-is) → null', () => {
    expect(
      resolveServerPusherConfig({
        PUSHER_APP_ID: '',
        PUSHER_KEY: '',
        PUSHER_SECRET: '',
        PUSHER_CLUSTER: 'us2',
      })
    ).toBeNull()
  })

  it('unconfigured: credentials but neither cluster nor host → null', () => {
    expect(resolveServerPusherConfig(CREDS)).toBeNull()
  })
})

describe('resolveClientPusherConfig', () => {
  it('cloud', () => {
    expect(
      resolveClientPusherConfig({
        NEXT_PUBLIC_PUSHER_KEY: 'k',
        NEXT_PUBLIC_PUSHER_CLUSTER: 'us2',
      })
    ).toEqual({ mode: 'cloud', key: 'k', cluster: 'us2', forceTLS: true })
  })

  it('custom host', () => {
    expect(
      resolveClientPusherConfig({
        NEXT_PUBLIC_PUSHER_KEY: 'k',
        NEXT_PUBLIC_PUSHER_HOST: 'localhost',
        NEXT_PUBLIC_PUSHER_PORT: '6001',
        NEXT_PUBLIC_PUSHER_USE_TLS: 'false',
      })
    ).toEqual({
      mode: 'custom',
      key: 'k',
      wsHost: 'localhost',
      wsPort: 6001,
      forceTLS: false,
    })
  })

  it('unconfigured → null', () => {
    expect(resolveClientPusherConfig({})).toBeNull()
    expect(
      resolveClientPusherConfig({ NEXT_PUBLIC_PUSHER_CLUSTER: 'us2' })
    ).toBeNull()
    expect(
      resolveClientPusherConfig({ NEXT_PUBLIC_PUSHER_KEY: 'k' })
    ).toBeNull()
  })
})

describe('readClientPusherEnv / isClientRealtimeConfigured', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('reads the NEXT_PUBLIC_ vars from process.env', () => {
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'k'
    process.env.NEXT_PUBLIC_PUSHER_HOST = 'h'
    expect(readClientPusherEnv()).toMatchObject({
      NEXT_PUBLIC_PUSHER_KEY: 'k',
      NEXT_PUBLIC_PUSHER_HOST: 'h',
    })
    expect(isClientRealtimeConfigured()).toBe(true)
  })

  it('is false when nothing is set', () => {
    expect(isClientRealtimeConfigured({})).toBe(false)
  })
})

describe('readServerPusherEnv', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  it('reads the PUSHER_ vars from process.env', () => {
    process.env.PUSHER_HOST = 'soketi'
    process.env.PUSHER_PORT = '6001'
    expect(readServerPusherEnv()).toMatchObject({
      PUSHER_HOST: 'soketi',
      PUSHER_PORT: '6001',
    })
  })
})
