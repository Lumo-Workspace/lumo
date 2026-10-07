/**
 * @jest-environment node
 */
// LUM-1022: runtime-neutral waitUntil — Vercel delegation vs self-hosted
// background execution, and rejection capture via the project logger.
//
// The real @vercel/functions is used (not mocked): "on Vercel" is simulated by
// installing a request context at globalThis[Symbol.for('@vercel/request-context')],
// which is exactly what @vercel/functions@3.x reads. VERCEL stays unset in every
// test so delegation is proven to follow the context, not the env var.
const loggerError = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('@vercel/functions/oidc', () => ({
  getVercelOidcToken: jest.fn(async () => 'oidc-token-fixture'),
}))

import { waitUntil } from '@/lib/runtime/wait-until'
import { getVercelOidcToken } from '@/lib/runtime/vercel-oidc'

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')
type ContextHolder = { [REQUEST_CONTEXT]?: { get: () => unknown } }
const holder = globalThis as unknown as ContextHolder

const flush = () => new Promise(resolve => setImmediate(resolve))

/** Install a fake Vercel request context; returns its waitUntil spy. */
function installVercelRequestContext(): jest.Mock {
  const contextWaitUntil = jest.fn()
  holder[REQUEST_CONTEXT] = { get: () => ({ waitUntil: contextWaitUntil }) }
  return contextWaitUntil
}

describe('waitUntil', () => {
  const originalVercel = process.env.VERCEL

  beforeEach(() => {
    loggerError.mockReset()
    delete process.env.VERCEL
    delete holder[REQUEST_CONTEXT]
  })

  afterAll(() => {
    delete holder[REQUEST_CONTEXT]
    if (originalVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
  })

  describe('self-hosted (no Vercel request context)', () => {
    it('runs the task in the background', async () => {
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

    it("leaves the caller's own promise untouched: their .catch still receives the rejection", async () => {
      const boom = new Error('caller-visible boom')
      const task = Promise.reject(boom)
      const callerCatch = jest.fn()
      waitUntil(task)
      await task.catch(callerCatch)
      expect(callerCatch).toHaveBeenCalledWith(boom)
      await flush()
      expect(loggerError).toHaveBeenCalledWith(
        '[waitUntil] background task failed:',
        boom
      )
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

  describe('inside a Vercel request context (VERCEL env unset)', () => {
    it('hands an observed promise to the context waitUntil that settles after the task', async () => {
      const contextWaitUntil = installVercelRequestContext()
      let release!: () => void
      const task = new Promise<void>(resolve => {
        release = resolve
      })
      waitUntil(task)
      expect(contextWaitUntil).toHaveBeenCalledTimes(1)
      const handed = contextWaitUntil.mock.calls[0][0] as Promise<unknown>
      expect(handed).not.toBe(task)
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
      const contextWaitUntil = installVercelRequestContext()
      const boom = new Error('vercel boom')
      waitUntil(Promise.reject(boom))
      const handed = contextWaitUntil.mock.calls[0][0] as Promise<unknown>
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
