/** @jest-environment node */
import { NextRequest } from 'next/server'
import * as nodeCrypto from 'node:crypto'
import { requireCronAuth, sameSecret } from '@/lib/api/cron-auth'

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto')
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) }
})

const req = (auth?: string) =>
  new NextRequest('https://x.test/api/cron/whatever', {
    headers: auth === undefined ? {} : { authorization: auth },
  })

describe('cron / internal route auth', () => {
  const OLD = process.env.CRON_SECRET
  afterEach(() => {
    if (OLD === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = OLD
  })

  it('fails closed when CRON_SECRET is unset — the whole point', async () => {
    // Every one of these routes used to inline
    //   if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return 401
    // which interpolates the STRING "undefined" when the variable is absent,
    // so this header walked straight through. The risk is not production,
    // where the secret is set — it is a preview deployment with an incomplete
    // env, where the URL is all an attacker needs.
    delete process.env.CRON_SECRET
    const res = requireCronAuth(req('Bearer undefined'))
    expect(res?.status).toBe(401)
  })

  it('cannot be authenticated with an empty CRON_SECRET', async () => {
    // What this does and does NOT prove: with `secret === ''` the template is
    // `"Bearer "`, and a header value's trailing whitespace is stripped on the
    // way in, so no client can send a string equal to it. The comparison branch
    // therefore rejects an empty secret on its own, which makes swapping
    // `!secret` for `secret === undefined` an EQUIVALENT mutation rather than a
    // hole — I checked. `!secret` stays because it states the intent at the
    // point the decision is made, instead of leaving it to an accident of
    // header normalisation.
    process.env.CRON_SECRET = ''
    for (const h of ['Bearer ', 'Bearer', '']) {
      expect(requireCronAuth(req(h))?.status).toBe(401)
    }
    expect(requireCronAuth(req())?.status).toBe(401)
  })

  it('refuses a missing, malformed or wrong header', async () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireCronAuth(req())?.status).toBe(401)
    expect(requireCronAuth(req('s3cret'))?.status).toBe(401)
    expect(requireCronAuth(req('Bearer wrong'))?.status).toBe(401)
    expect(requireCronAuth(req('bearer s3cret'))?.status).toBe(401)
  })

  it('lets the real caller through, and says so by returning null', async () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireCronAuth(req('Bearer s3cret'))).toBeNull()
  })
})

describe('LUM-888 constant-time comparison', () => {
  const OLD = process.env.CRON_SECRET
  afterEach(() => {
    if (OLD === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = OLD
  })

  it('LUM-888 cron secret is compared in constant time', () => {
    process.env.CRON_SECRET = 's3cret'
    const safeEqual = nodeCrypto.timingSafeEqual as unknown as jest.Mock
    safeEqual.mockClear()

    expect(requireCronAuth(req('Bearer s3cret'))).toBeNull()
    // The decision went through timingSafeEqual, on equal-length digests.
    expect(safeEqual).toHaveBeenCalledTimes(1)
    const [a, b] = safeEqual.mock.calls[0] as [Buffer, Buffer]
    expect(a.length).toBe(b.length)

    // Wrong, missing and differently-sized headers are still refused — a
    // length mismatch must not throw out of timingSafeEqual either.
    for (const h of [
      'Bearer s3creT',
      'Bearer s3cret-and-more',
      'Bearer s',
      '',
    ]) {
      expect(requireCronAuth(req(h))?.status).toBe(401)
    }
    expect(requireCronAuth(req())?.status).toBe(401)
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abcd')).toBe(false)
  })
})

describe('every cron and internal route is behind that gate', () => {
  it('no route compares against the env var inline any more', () => {
    // A route that re-inlines the comparison re-introduces the hole, and the
    // hole is invisible until an environment is missing the variable. Assert
    // over the routes on disk rather than over a list someone has to remember
    // to update.
    const { readdirSync, readFileSync, statSync } =
      require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(e => {
        const p = join(dir, e)
        return statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith('route.ts')
            ? [p]
            : []
      })

    const routes = [
      ...walk(join(process.cwd(), 'app/api/cron')),
      ...walk(join(process.cwd(), 'app/api/internal')),
    ]
    expect(routes.length).toBeGreaterThanOrEqual(9)

    const offenders = routes.filter(p => {
      const src = readFileSync(p, 'utf8')
      return src.includes('process.env.CRON_SECRET')
    })
    expect(offenders).toEqual([])

    const ungated = routes.filter(
      p => !readFileSync(p, 'utf8').includes('requireCronAuth')
    )
    expect(ungated).toEqual([])
  })
})
