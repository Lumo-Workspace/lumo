/**
 * @jest-environment node
 */
import {
  PUBLIC_CONFIG_GLOBAL,
  readBuildTimePublicConfig,
  readPublicConfig,
  renderPublicConfigScript,
  resolveAppUrl,
  resolvePublicConfig,
} from '@/lib/config/public-config'
import { GET } from '@/app/api/public-config/route'

const KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_PUSHER_KEY',
  'NEXT_PUBLIC_PUSHER_CLUSTER',
  'NEXT_PUBLIC_PUSHER_HOST',
  'NEXT_PUBLIC_PUSHER_PORT',
  'NEXT_PUBLIC_PUSHER_USE_TLS',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('resolvePublicConfig', () => {
  it('reads the app URL and pusher vars, trimming and dropping trailing slashes', () => {
    expect(
      resolvePublicConfig({
        NEXT_PUBLIC_APP_URL: ' https://lumo.example.com// ',
        NEXT_PUBLIC_PUSHER_KEY: 'lumo',
        NEXT_PUBLIC_PUSHER_HOST: 'lumo.example.com',
        NEXT_PUBLIC_PUSHER_PORT: '443',
        NEXT_PUBLIC_PUSHER_USE_TLS: 'true',
      })
    ).toEqual({
      appUrl: 'https://lumo.example.com',
      pusher: {
        NEXT_PUBLIC_PUSHER_KEY: 'lumo',
        NEXT_PUBLIC_PUSHER_CLUSTER: undefined,
        NEXT_PUBLIC_PUSHER_HOST: 'lumo.example.com',
        NEXT_PUBLIC_PUSHER_PORT: '443',
        NEXT_PUBLIC_PUSHER_USE_TLS: 'true',
      },
    })
  })

  it('treats blank values as unset', () => {
    const config = resolvePublicConfig({ NEXT_PUBLIC_APP_URL: '   ' })
    expect(config.appUrl).toBeUndefined()
    expect(config.pusher.NEXT_PUBLIC_PUSHER_KEY).toBeUndefined()
  })
})

describe('server-side reads', () => {
  it('readPublicConfig and resolveAppUrl follow the env at call time', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://one.example.com'
    expect(resolveAppUrl()).toBe('https://one.example.com')
    process.env.NEXT_PUBLIC_APP_URL = 'https://two.example.com/'
    expect(resolveAppUrl()).toBe('https://two.example.com')
    expect(readPublicConfig().appUrl).toBe('https://two.example.com')
  })

  it('resolveAppUrl is undefined when unset', () => {
    expect(resolveAppUrl()).toBeUndefined()
  })

  it('readBuildTimePublicConfig reads the literal NEXT_PUBLIC_* names', () => {
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'k'
    expect(readBuildTimePublicConfig().pusher.NEXT_PUBLIC_PUSHER_KEY).toBe('k')
  })
})

describe('renderPublicConfigScript', () => {
  it('assigns the config to the window global', () => {
    const script = renderPublicConfigScript({
      appUrl: 'https://lumo.example.com',
      pusher: {},
    })
    const win: Record<string, unknown> = {}
    new Function('window', script)(win)
    expect(win[PUBLIC_CONFIG_GLOBAL]).toEqual({
      appUrl: 'https://lumo.example.com',
      pusher: {},
    })
  })

  it('escapes characters that could end the script element', () => {
    const script = renderPublicConfigScript({
      appUrl: 'https://x.example.com/</script><script>alert(1)</script>\u2028',
      pusher: {},
    })
    expect(script).not.toContain('</script>')
    expect(script).not.toContain('\u2028')
    const win: Record<string, { appUrl: string }> = {}
    new Function('window', script)(win)
    expect(win[PUBLIC_CONFIG_GLOBAL]?.appUrl).toBe(
      'https://x.example.com/</script><script>alert(1)</script>\u2028'
    )
  })
})

describe('GET /api/public-config', () => {
  it('serves the runtime env as JavaScript', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://runtime.example.com'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'lumo'
    const res = GET()
    expect(res.headers.get('content-type')).toContain('application/javascript')
    const body = await res.text()
    const win: Record<string, unknown> = {}
    new Function('window', body)(win)
    expect(win[PUBLIC_CONFIG_GLOBAL]).toMatchObject({
      appUrl: 'https://runtime.example.com',
      pusher: { NEXT_PUBLIC_PUSHER_KEY: 'lumo' },
    })
  })
})
