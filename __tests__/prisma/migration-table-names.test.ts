/**
 * @jest-environment node
 *
 * Guard for the LUM-709 production incident: the drop-risk-assessment migration
 * was hand-written against the Prisma **model** names (`ALTER TABLE "Workspace"`)
 * while the physical tables are `workspaces` / `projects` via `@@map`. Postgres
 * answered 42P01, the migrate gate failed closed, and every production deploy
 * stayed blocked until the failed migration row was resolved.
 *
 * The invariant: a migration never names a table by a model name that carries an
 * `@@map` — that name does not exist in the database, ever. Tables that were
 * dropped over time (agent_runs, lumo_proposals…) are deliberately not checked;
 * they are legitimately absent from today's schema.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

/** model name → physical table name, for every model that declares `@@map`. */
function mappedModels(): Map<string, string> {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8'
  )
  const out = new Map<string, string>()
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(schema)) !== null) {
    const mapped = /@@map\("([^"]+)"\)/.exec(m[2]!)
    if (mapped) out.set(m[1]!, mapped[1]!)
  }
  return out
}

function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      sql: readFileSync(join(MIGRATIONS_DIR, d.name, 'migration.sql'), 'utf8'),
    }))
}

const TABLE_REF_RE =
  /(?:ALTER|CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"([^"]+)"/gi

describe('migration SQL uses physical table names', () => {
  const mapped = mappedModels()

  it('has a schema with mapped models to check against', () => {
    expect(mapped.size).toBeGreaterThan(0)
    expect(mapped.get('Workspace')).toBe('workspaces')
    expect(mapped.get('Project')).toBe('projects')
  })

  it('no migration references a @@map model name instead of its table', () => {
    const offenders: string[] = []
    for (const { name, sql } of migrationFiles()) {
      for (const match of sql.matchAll(TABLE_REF_RE)) {
        const table = match[1]!
        const physical = mapped.get(table)
        if (physical) {
          offenders.push(`${name}: "${table}" should be "${physical}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the LUM-709 drop migration targets workspaces and projects', () => {
    const sql = readFileSync(
      join(
        MIGRATIONS_DIR,
        '20260727000000_drop_risk_assessment',
        'migration.sql'
      ),
      'utf8'
    )
    const targets = [...sql.matchAll(TABLE_REF_RE)].map(m => m[1])
    expect(new Set(targets)).toEqual(new Set(['workspaces', 'projects']))
    expect(sql.match(/DROP COLUMN/g)).toHaveLength(12)
  })
})
