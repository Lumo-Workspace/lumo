import { buildTemplateUpserts } from '@/prisma/seed'
import { SYSTEM_TEMPLATES } from '@/lib/editor/templates'

describe('buildTemplateUpserts', () => {
  it('produces one idempotent upsert arg per system template, keyed by key', () => {
    const upserts = buildTemplateUpserts()
    expect(upserts).toHaveLength(SYSTEM_TEMPLATES.length)

    const first = upserts[0]
    expect(first).toBeDefined()
    expect(first!.where).toEqual({ key: 'prd' })
    // create + update carry the same content/emoji/sortOrder so re-runs converge
    expect(first!.update.content).toBe(first!.create.content)
    expect(first!.create.workspaceId).toBeNull()
    expect(first!.create.isSystem).toBe(true)
  })
})
