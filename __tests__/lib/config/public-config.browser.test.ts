/**
 * @jest-environment jsdom
 */
import {
  PUBLIC_CONFIG_GLOBAL,
  readPublicConfig,
  resolveAppUrl,
} from '@/lib/config/public-config'
import { readClientPusherEnv } from '@/lib/integrations/pusher/config'

afterEach(() => {
  delete window[PUBLIC_CONFIG_GLOBAL]
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('public config in the browser', () => {
  it('prefers the runtime global set by /api/public-config', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    window[PUBLIC_CONFIG_GLOBAL] = {
      appUrl: 'https://lumo.example.com',
      pusher: {
        NEXT_PUBLIC_PUSHER_KEY: 'lumo',
        NEXT_PUBLIC_PUSHER_PORT: '443',
      },
    }
    expect(resolveAppUrl()).toBe('https://lumo.example.com')
    expect(readClientPusherEnv()).toEqual({
      NEXT_PUBLIC_PUSHER_KEY: 'lumo',
      NEXT_PUBLIC_PUSHER_PORT: '443',
    })
  })

  it('falls back to the build-time values when the script did not run', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000/'
    expect(readPublicConfig().appUrl).toBe('http://localhost:3000')
  })
})
