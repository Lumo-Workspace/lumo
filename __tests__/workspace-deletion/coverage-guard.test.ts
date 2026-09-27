/**
 * @jest-environment node
 *
 * LUM-861 guard: deleting a workspace must remove every row it owns. Every
 * model in prisma/schema.prisma must be (a) cascade-reachable from Workspace,
 * (b) purged explicitly by the deletion repository, or (c) declared as not
 * workspace data with a reason. A new model that is none of these fails here —
 * decide which bucket it belongs in before it ships.
 */
import { readFileSync } from 'fs'
import path from 'path'
import {
  cascadeReachableModels,
  parseModelNames,
  parseRelations,
  uncoveredModels,
} from '@/lib/workspace/deletion-coverage'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
import {
  EXPLICITLY_PURGED_MODELS,
  NON_WORKSPACE_MODELS,
} from '@/lib/repositories/workspace-deletion.repository'

const schema = readFileSync(
  path.resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8'
)
const covered = new Set<string>([
  ...EXPLICITLY_PURGED_MODELS,
  ...Object.keys(NON_WORKSPACE_MODELS),
])

describe('workspace deletion coverage guard', () => {
  it('every schema model is cascaded, purged explicitly, or declared non-workspace', () => {
    expect(uncoveredModels(schema, 'Workspace', covered)).toEqual([])
  })

  it('explicit and non-workspace lists name real models the cascade does not already reach', () => {
    const models = new Set(parseModelNames(schema))
    const reached = cascadeReachableModels(schema, 'Workspace')
    for (const m of covered) {
      expect(models.has(m)).toBe(true)
      expect(reached.has(m)).toBe(false)
    }
  })

  it('no relation into the cascade set blocks the delete with a Restrict on Workspace', () => {
    const blocking = parseRelations(schema).filter(
      r => r.target === 'Workspace' && r.onDelete !== 'Cascade'
    )
    // Only nullable pointers that SetNull may reference Workspace without Cascade.
    for (const r of blocking) expect(r.onDelete).toBe('SetNull')
  })

  it('a newly added model with no cascade path and no declaration fails the guard', () => {
    const withNewModel = `${schema}\nmodel BrandNewThing {\n  id          String @id\n  workspaceId String\n}\n`
    expect(uncoveredModels(withNewModel, 'Workspace', covered)).toEqual([
      'BrandNewThing',
    ])
  })
})

describe('deletion-coverage schema parsing', () => {
  const tiny = [
    'model Root {',
    '  id String @id',
    '}',
    'model Child {',
    '  id     String @id',
    '  rootId String',
    '  root   Root   @relation(fields: [rootId], references: [id], onDelete: Cascade)',
    '}',
    'model Grandchild {',
    '  id      String @id',
    '  childId String',
    '  child   Child  @relation(fields: [childId], references: [id], onDelete: Cascade)',
    '}',
    'model Blocked {',
    '  id     String @id',
    '  rootId String',
    '  root   Root   @relation(fields: [rootId], references: [id])',
    '}',
    'model Loose {',
    '  id     String @id',
    '  // root Root @relation(fields: [rootId], references: [id], onDelete: Cascade)',
    '}',
  ].join('\n')

  it('follows cascades transitively and ignores commented-out relations', () => {
    expect([...cascadeReachableModels(tiny, 'Root')].sort()).toEqual([
      'Child',
      'Grandchild',
      'Root',
    ])
    expect(uncoveredModels(tiny, 'Root', new Set())).toEqual([
      'Blocked',
      'Loose',
    ])
  })

  it('reports a relation without onDelete as null (schema default)', () => {
    expect(parseRelations(tiny).find(r => r.model === 'Blocked')).toMatchObject(
      { target: 'Root', onDelete: null }
    )
  })
})
