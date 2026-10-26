/**
 * @jest-environment node
 *
 * LUM-1303: a GDPR workspace export carries every stored decision — deleted
 * ones (tombstones) included, with `deletedAt` — and its number.
 */
describe('workspace export: task decisions', () => {
  it('reads the workspace rows with number and deletedAt', async () => {
    jest.resetModules()
    const findMany = jest.fn(async () => [])
    jest.doMock('@/lib/db/prisma', () => ({
      prisma: { taskDecision: { findMany } },
    }))
    const { EXPORT_KINDS, workspaceExportRepository } =
      await import('@/lib/repositories/workspace-export.repository')
    const { EXPORTED_MODELS } = await import('@/lib/workspace/export-coverage')
    expect(EXPORT_KINDS).toContain('task-decisions')
    expect(EXPORTED_MODELS).toContain('TaskDecision')
    await workspaceExportRepository.pageRows('task-decisions', 'ws-a', null, 10)
    const arg = (
      findMany.mock.calls[0] as unknown as [
        { where: unknown; select: Record<string, unknown> },
      ]
    )[0]
    // No deletedAt filter: tombstones are exported too.
    expect(arg.where).toEqual({ workspaceId: 'ws-a' })
    expect(arg.select).toMatchObject({
      number: true,
      text: true,
      rationale: true,
      deletedAt: true,
    })
    expect(arg.select).not.toHaveProperty('sourceSessionId')
  })
})
