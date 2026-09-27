/**
 * LUM-861: which Prisma models does deleting a Workspace reach?
 *
 * Pure schema-text analysis (no DB, no Prisma runtime — the Prisma 7 runtime
 * DMMF no longer carries `onDelete`). A model is cascade-reachable from the
 * root when it holds a relation `@relation(fields: …, onDelete: Cascade)` to a
 * model that is itself reachable. Everything else survives a
 * `workspace.delete()` and must be purged explicitly or be declared as not
 * workspace data — the guard test holds every model to one of those three.
 */

export interface SchemaRelation {
  model: string
  field: string
  target: string
  /** The explicit `onDelete:` action, or null when the schema leaves it default. */
  onDelete: string | null
}

const MODEL_BLOCK_RE = /^model (\w+) \{([\s\S]*?)\n\}/gm

/** Every `model` name declared in the schema, in declaration order. */
export function parseModelNames(schema: string): string[] {
  return [...schema.matchAll(MODEL_BLOCK_RE)].map(m => m[1] as string)
}

/** The FK-holding side of every relation (the field that lists `fields:`). */
export function parseRelations(schema: string): SchemaRelation[] {
  const out: SchemaRelation[] = []
  for (const [, model, body] of schema.matchAll(MODEL_BLOCK_RE)) {
    for (const raw of (body as string).split('\n')) {
      const line = raw.trim()
      if (line.startsWith('//')) continue
      if (!line.includes('@relation(') || !line.includes('fields:')) continue
      const [field, type] = line.split(/\s+/)
      if (!field || !type) continue
      out.push({
        model: model as string,
        field,
        target: type.replace(/[?[\]]/g, ''),
        onDelete: line.match(/onDelete:\s*(\w+)/)?.[1] ?? null,
      })
    }
  }
  return out
}

/** Models removed by the database when `root` is deleted (root included). */
export function cascadeReachableModels(
  schema: string,
  root: string
): Set<string> {
  const relations = parseRelations(schema).filter(r => r.onDelete === 'Cascade')
  const reached = new Set([root])
  let grew = true
  while (grew) {
    grew = false
    for (const r of relations) {
      if (reached.has(r.target) && !reached.has(r.model)) {
        reached.add(r.model)
        grew = true
      }
    }
  }
  return reached
}

/**
 * Models that deleting `root` leaves behind and that are neither purged
 * explicitly nor declared as non-workspace data. Empty = full coverage.
 */
export function uncoveredModels(
  schema: string,
  root: string,
  covered: ReadonlySet<string>
): string[] {
  const reached = cascadeReachableModels(schema, root)
  return parseModelNames(schema).filter(m => !reached.has(m) && !covered.has(m))
}
