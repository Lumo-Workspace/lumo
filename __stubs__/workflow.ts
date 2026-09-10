/**
 * Jest stand-in for the `workflow` package (LUM-735 v4). The real entrypoint
 * is ESM-only (and its `require` export condition is the TypeScript plugin),
 * so Jest cannot load it; `jest.config.js` maps `^workflow$` here. Outside a
 * compiled workflow bundle the directives are no-ops, so step functions are
 * plain async functions and `sleep` is the only import that needs a
 * stand-in.
 */
export const sleep = jest.fn(async (_duration: string | Date) => undefined)
