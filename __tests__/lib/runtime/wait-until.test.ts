/**
 * @jest-environment node
 */
// LUM-1022: runtime-neutral waitUntil — Vercel delegation vs self-hosted
// background execution, and rejection capture via the project logger.
const vercelWaitUntil = jest.fn()
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => vercelWaitUntil(p),
}))
const loggerError = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

import { isVercelRuntime, waitUntil } from '@/lib/runtime/wait-until'
import { getVercelOidcToken } from '@/lib/runtime/vercel-oidc'

jest.mock('@vercel/functions/oidc', () => ({
  getVercelOidcToken: jest.fn(async () => 'oidc-token-fixture'),
}))

const flush = () => new Promise(resolve => setImmediate(resolve))

describe('isVercelRuntime', () => {
  it('is true only when VERCEL is set', () => {
    expect(isVercelRuntime({ VERCEL: '1' })).toBe(true)
    expect(isVercelRuntime({})).toBe(false)
    expect(isVercelRuntime({ VERCEL: '' })).toBe(false)
  })
})

describe('waitUntil', () => {
  const originalVercel = process.env.VERCEL

  beforeEach(() => {
    vercelWaitUntil.mockReset()
    loggerError.mockReset()
  })

  afterAll(() => {
    if (originalVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
  })

  describe('self-hosted (no VERCEL env)', () => {
    beforeEach(() => {
      delete process.env.VERCEL
    })

    it('runs the task in the background without calling Vercel waitUntil', async () => {
      const done = jest.fn()
      waitUntil(
        (async () => {
          await flush()
          done()
        })()
      )
      expect(done).not.toHaveBeenCalled()
      await flush()
      await flush()
      expect(done).toHaveBeenCalledTimes(1)
      expect(vercelWaitUntil).not.toHaveBeenCalled()
      expect(loggerError).not.toHaveBeenCalled()
    })

    it('captures a rejection and logs it instead of leaving it unhandled', async () => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const boom = new Error('background boom')
        waitUntil(Promise.reject(boom))
        await flush()
        await flush()
        expect(loggerError).toHaveBeenCalledWith(
          '[waitUntil] background task failed:',
          boom
        )
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('does not produce an unhandled rejection when logger.error itself throws', async () => {
      loggerError.mockImplementation(() => {
        throw new Error('log transport down')
      })
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        waitUntil(Promise.reject(new Error('task failed')))
        await flush()
        await flush()
        expect(loggerError).toHaveBeenCalledTimes(1)
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('does not throw synchronously for a rejected promise', () => {
      expect(() => waitUntil(Promise.reject(new Error('x')))).not.toThrow()
    })
  })

  describe('on Vercel (VERCEL=1)', () => {
    beforeEach(() => {
      process.env.VERCEL = '1'
    })

    it('hands an observed promise to Vercel waitUntil that settles after the task', async () => {
      let release!: () => void
      const task = new Promise<void>(resolve => {
        release = resolve
      })
      waitUntil(task)
      expect(vercelWaitUntil).toHaveBeenCalledTimes(1)
      const handed = vercelWaitUntil.mock.calls[0][0] as Promise<unknown>
      let settled = false
      void handed.then(() => {
        settled = true
      })
      await flush()
      expect(settled).toBe(false)
      release()
      await flush()
      expect(settled).toBe(true)
    })

    it('still logs a rejection and the promise handed to Vercel resolves', async () => {
      const boom = new Error('vercel boom')
      waitUntil(Promise.reject(boom))
      const handed = vercelWaitUntil.mock.calls[0][0] as Promise<unknown>
      await expect(handed).resolves.toBeUndefined()
      expect(loggerError).toHaveBeenCalledWith(
        '[waitUntil] background task failed:',
        boom
      )
    })
  })

  it('rejects non-promise input like the Vercel implementation', () => {
    expect(() => waitUntil(undefined as unknown as Promise<unknown>)).toThrow(
      TypeError
    )
    expect(() => waitUntil(42 as unknown as Promise<unknown>)).toThrow(
      'waitUntil can only be called with a Promise, got number'
    )
  })
})

describe('getVercelOidcToken', () => {
  it('delegates to @vercel/functions/oidc', async () => {
    await expect(getVercelOidcToken()).resolves.toBe('oidc-token-fixture')
  })
})
