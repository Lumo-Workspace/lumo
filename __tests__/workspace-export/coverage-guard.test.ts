/**
 * @jest-environment node
 *
 * LUM-858 guard: every model with its own `workspaceId` column is either in
 * the GDPR export or excluded with a stated reason. A new workspace-scoped
 * model fails here until someone decides whether customers get it back.
 */
import { readFileSync } from 'fs'
import path from 'path'
import {
  EXCLUDED_MODELS,
  EXPORTED_MODELS,
  unclassifiedModels,
  workspaceKeyedModels,
} from '@/lib/workspace/export-coverage'

const schema = readFileSync(
  path.resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8'
)

describe('workspace export coverage guard', () => {
  it('LUM-858 coverage: every workspace-keyed model is exported or excluded with a reason', () => {
    expect(workspaceKeyedModels(schema).length).toBeGreaterThan(30)
    expect(unclassifiedModels(schema)).toEqual([])
    for (const reason of Object.values(EXCLUDED_MODELS)) {
      expect(reason.trim().length).toBeGreaterThan(0)
    }
  })

  it('LUM-858 coverage: the lists name real workspace-keyed models and never both', () => {
    const keyed = new Set(workspaceKeyedModels(schema))
    for (const m of [...EXPORTED_MODELS, ...Object.keys(EXCLUDED_MODELS)]) {
      expect(keyed.has(m)).toBe(true)
    }
    for (const m of EXPORTED_MODELS) {
      expect(EXCLUDED_MODELS).not.toHaveProperty([m])
    }
  })

  it('LUM-858 coverage: a newly added workspace-keyed model fails the guard', () => {
    const withNew = `${schema}\nmodel BrandNewThing {\n  id          String @id\n  workspaceId String\n}\n`
    expect(unclassifiedModels(withNew)).toEqual(['BrandNewThing'])
  })
})
