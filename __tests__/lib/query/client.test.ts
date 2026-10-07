import {
  makeQueryClient,
  NO_REALTIME_REFETCH_INTERVAL_MS,
} from '@/lib/query/client'

describe('makeQueryClient realtime fallback', () => {
  it('with realtime: no polling, no refetch on focus (Pusher drives updates)', () => {
    const q = makeQueryClient(true).getDefaultOptions().queries!
    expect(q.refetchInterval).toBe(false)
    expect(q.refetchOnWindowFocus).toBe(false)
  })

  it('without realtime: refetch on focus + modest interval, not in background', () => {
    const q = makeQueryClient(false).getDefaultOptions().queries!
    expect(q.refetchInterval).toBe(NO_REALTIME_REFETCH_INTERVAL_MS)
    expect(q.refetchOnWindowFocus).toBe(true)
    expect(q.refetchIntervalInBackground).toBe(false)
  })

  describe('default from NEXT_PUBLIC_ env', () => {
    const saved = { ...process.env }
    beforeEach(() => {
      for (const k of Object.keys(process.env)) {
        if (k.startsWith('NEXT_PUBLIC_PUSHER_')) delete process.env[k]
      }
    })
    afterEach(() => {
      process.env = { ...saved }
    })

    it('unset → fallback on', () => {
      const q = makeQueryClient().getDefaultOptions().queries!
      expect(q.refetchOnWindowFocus).toBe(true)
    })

    it('configured → fallback off', () => {
      process.env.NEXT_PUBLIC_PUSHER_KEY = 'k'
      process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'
      const q = makeQueryClient().getDefaultOptions().queries!
      expect(q.refetchOnWindowFocus).toBe(false)
      expect(q.refetchInterval).toBe(false)
    })
  })
})
