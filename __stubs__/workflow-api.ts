/** Jest stand-in for `workflow/api` (see __stubs__/workflow.ts). */
export const start = jest.fn(
  async (_workflow: unknown, _args?: unknown[], _options?: unknown) => ({
    runId: 'run_stub',
    status: Promise.resolve('running' as const),
  })
)

/**
 * LUM-745: `getRun(runId).cancel()`; LUM-1030: `getRun(runId).status` (a
 * Promise, like the real getter) for the post-cancel guards.
 */
export const getRun = jest.fn((_runId: string) => ({
  cancel: jest.fn(async () => undefined),
  status: Promise.resolve('running' as string),
}))
