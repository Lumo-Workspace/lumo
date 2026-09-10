/** Jest stand-in for `workflow/api` (see __stubs__/workflow.ts). */
export const start = jest.fn(
  async (_workflow: unknown, _args?: unknown[], _options?: unknown) => ({
    runId: 'run_stub',
    status: Promise.resolve('running' as const),
  })
)
