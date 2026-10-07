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

  it('defaults from NEXT_PUBLIC_ env (unset → fallback on)', () => {
    delete process.env.NEXT_PUBLIC_PUSHER_KEY
    const q = makeQueryClient().getDefaultOptions().queries!
    expect(q.refetchOnWindowFocus).toBe(true)
  })
})
