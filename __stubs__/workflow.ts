/**
 * Jest stand-in for the `workflow` package (LUM-735 v4). The real entrypoint
 * is ESM-only (and its `require` export condition is the TypeScript plugin),
 * so Jest cannot load it; `jest.config.js` maps `^workflow$` here. Outside a
 * compiled workflow bundle the directives are no-ops, so step functions are
 * plain async functions and only these helpers need a stand-in.
 */
export const sleep = jest.fn(async (_duration: string | Date) => undefined)

export class FatalError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'FatalError'
  }
}

export class RetryableError extends Error {
  retryAfter: string | Date | undefined
  constructor(message?: string, options?: { retryAfter?: string | Date }) {
    super(message)
    this.name = 'RetryableError'
    this.retryAfter = options?.retryAfter
  }
}
