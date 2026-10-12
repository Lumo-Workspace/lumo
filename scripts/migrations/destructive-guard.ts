/**
 * Destructive-migration guard — LUM-1085.
 *
 * Incident it prevents (2026-10-12, #1397 / LUM-1083): the production deploy
 * gate (scripts/deploy/vercel-build.sh) runs `prisma migrate deploy` at the
 * START of the build, while the previous deployment is still serving. The
 * migration dropped `tasks.initiativeId`; the old code still selected it (Prisma
 * selects every scalar column of a model by default) → task APIs returned 500
 * for ~3–4 minutes until the new build went Ready. The same drop also makes an
 * Instant Rollback to any earlier deployment 500.
 *
 * Rule it enforces — two-phase (expand/contract) removal, see
 * docs/database-migrations.md:
 *   1. Expand release: the code stops reading/writing the column/table/enum
 *      value (remove the field from schema.prisma, or mark it `@ignore` /
 *      `@@ignore`) — NO destructive SQL.
 *   2. Contract release (a later deploy): the migration that drops it.
 *
 * Mechanically, for every migration that is new relative to a base ref (default
 * `origin/main` ≈ the code production is serving), each schema-breaking
 * statement — DROP COLUMN / DROP TABLE / RENAME COLUMN / RENAME TABLE / enum
 * value removal or rename / DROP TYPE — must target something the BASE
 * revision's schema.prisma no longer maps (or maps only as `@ignore`d). If the
 * base schema still maps it, the old code still reads it while the migration
 * runs → hard failure. Each such migration must also carry the explicit marker
 * `-- lumo:contract-phase <reason>` (enforced repo-wide by
 * __tests__/scripts/destructive-migration-guard.test.ts, which needs no git).
 *
 * Wiring: lint-staged runs this on any staged `prisma/migrations/**` SQL
 * (pre-commit), and `npm run migrations:check` runs it on demand.
 */
import { execFileSync } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/** Comment marker a contract-phase (destructive) migration must carry. */
export const CONTRACT_MARKER = 'lumo:contract-phase'

const MIGRATIONS_DIR = 'prisma/migrations'
const SCHEMA_PATH = 'prisma/schema.prisma'

export type DestructiveOp =
  | { kind: 'dropColumn'; table: string; column: string; statement: string }
  | { kind: 'renameColumn'; table: string; column: string; statement: string }
  | { kind: 'dropTable'; table: string; statement: string }
  | { kind: 'renameTable'; table: string; statement: string }
  | { kind: 'dropType'; type: string; statement: string }
  | { kind: 'renameType'; type: string; statement: string }
  /** `CREATE TYPE "X_new" AS ENUM (…)` — the Prisma enum-recreate pattern. */
  | { kind: 'recreateEnum'; type: string; values: string[]; statement: string }
  | { kind: 'renameEnumValue'; type: string; value: string; statement: string }

export type SchemaIndex = {
  /** db table name → its model. */
  tables: Map<
    string,
    {
      model: string
      ignored: boolean
      columns: Map<string, { field: string; ignored: boolean }>
    }
  >
  /** db enum type name → enum + its db value names. */
  enums: Map<string, { name: string; values: Set<string> }>
}

export type Violation = {
  migration: string
  kind: 'still-referenced' | 'missing-marker'
  message: string
}

// ─── SQL tokenizing ─────────────────────────────────────────────────────────

/**
 * Split SQL into statements on top-level `;`, dropping comments. Understands
 * single-quoted strings, double-quoted identifiers and dollar-quoted bodies
 * (`$$…$$`, `$fn$…$fn$`) so trigger/function bodies are not split or scanned.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      cur += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        const stop = end === -1 ? sql.length : end + tag[0].length
        // Body is opaque: keep a placeholder so the statement stays non-empty.
        cur += ' $body$ '
        i = stop
        continue
      }
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Split on top-level commas (outside quotes and parentheses). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  let quote: string | null = null
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** One identifier, optionally schema-qualified: `"public"."tasks"`, `tasks`. */
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

/** Normalize an identifier: last qualified part, unquoted (unquoted → lower). */
export function normIdent(raw: string): string {
  const parts = raw.match(new RegExp(IDENT, 'g')) ?? [raw]
  const last = parts[parts.length - 1]!.trim()
  if (last.startsWith('"')) return last.slice(1, -1).replace(/""/g, '"')
  return last.toLowerCase()
}

function sqlStrings(list: string): string[] {
  return [...list.matchAll(/'((?:[^']|'')*)'/g)].map(m =>
    m[1]!.replace(/''/g, "'")
  )
}

// ─── Destructive-op extraction ─────────────────────────────────────────────

/** Extract every schema-breaking operation from a migration's SQL. */
export function extractDestructiveOps(sql: string): DestructiveOp[] {
  const ops: DestructiveOp[] = []
  for (const raw of splitStatements(sql)) {
    const stmt = raw.replace(/\s+/g, ' ').trim()

    const alterTable = new RegExp(
      String.raw`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(${QUALIFIED}) (.*)$`,
      'is'
    ).exec(stmt)
    if (alterTable) {
      const table = normIdent(alterTable[1]!)
      for (const action of splitTopLevel(alterTable[2]!)) {
        const renameTo = new RegExp(
          String.raw`^RENAME TO (${IDENT})$`,
          'i'
        ).exec(action)
        if (renameTo) {
          ops.push({ kind: 'renameTable', table, statement: stmt })
          continue
        }
        if (/^(DROP|RENAME) CONSTRAINT\b/i.test(action)) continue
        const renameCol = new RegExp(
          String.raw`^RENAME (?:COLUMN )?(${IDENT}) TO (${IDENT})$`,
          'i'
        ).exec(action)
        if (renameCol) {
          ops.push({
            kind: 'renameColumn',
            table,
            column: normIdent(renameCol[1]!),
            statement: stmt,
          })
          continue
        }
        const dropCol = new RegExp(
          String.raw`^DROP (?:COLUMN )?(?:IF EXISTS )?(${IDENT})(?: (?:CASCADE|RESTRICT))?$`,
          'i'
        ).exec(action)
        if (dropCol) {
          ops.push({
            kind: 'dropColumn',
            table,
            column: normIdent(dropCol[1]!),
            statement: stmt,
          })
        }
      }
      continue
    }

    const dropTable =
      /^DROP TABLE (?:IF EXISTS )?(.*?)(?: (?:CASCADE|RESTRICT))?$/i.exec(stmt)
    if (dropTable) {
      for (const t of splitTopLevel(dropTable[1]!)) {
        ops.push({ kind: 'dropTable', table: normIdent(t), statement: stmt })
      }
      continue
    }

    const dropType =
      /^DROP TYPE (?:IF EXISTS )?(.*?)(?: (?:CASCADE|RESTRICT))?$/i.exec(stmt)
    if (dropType) {
      for (const t of splitTopLevel(dropType[1]!)) {
        ops.push({ kind: 'dropType', type: normIdent(t), statement: stmt })
      }
      continue
    }

    const createEnum = new RegExp(
      String.raw`^CREATE TYPE (${QUALIFIED}) AS ENUM \((.*)\)$`,
      'is'
    ).exec(stmt)
    if (createEnum) {
      const name = normIdent(createEnum[1]!)
      if (name.endsWith('_new')) {
        ops.push({
          kind: 'recreateEnum',
          type: name.slice(0, -'_new'.length),
          values: sqlStrings(createEnum[2]!),
          statement: stmt,
        })
      }
      continue
    }

    const renameValue = new RegExp(
      String.raw`^ALTER TYPE (${QUALIFIED}) RENAME VALUE '((?:[^']|'')*)' TO '`,
      'i'
    ).exec(stmt)
    if (renameValue) {
      ops.push({
        kind: 'renameEnumValue',
        type: normIdent(renameValue[1]!),
        value: renameValue[2]!.replace(/''/g, "'"),
        statement: stmt,
      })
      continue
    }

    const renameType = new RegExp(
      String.raw`^ALTER TYPE (${QUALIFIED}) RENAME TO (${IDENT})$`,
      'i'
    ).exec(stmt)
    if (renameType) {
      const from = normIdent(renameType[1]!)
      const to = normIdent(renameType[2]!)
      // `X → X_old` and `X_new → X` are the two halves of Prisma's enum
      // recreate, judged via the `recreateEnum` op instead.
      if (to === `${from}_old` || from === `${to}_new`) continue
      ops.push({ kind: 'renameType', type: from, statement: stmt })
    }
  }
  // `DROP TYPE "X_old"` is the tail of an enum recreate in the same migration;
  // the `recreateEnum` op already judges it.
  const recreated = new Set(
    ops.flatMap(o => (o.kind === 'recreateEnum' ? [o.type] : []))
  )
  return ops.filter(
    o =>
      !(
        o.kind === 'dropType' &&
        o.type.endsWith('_old') &&
        recreated.has(o.type.slice(0, -4))
      )
  )
}

// ─── Prisma schema index ───────────────────────────────────────────────────

const SCALAR_TYPES = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
])

/** Drop a `//` comment, but not a `//` inside a string (`@default("https://…")`). */
export function stripLineComment(line: string): string {
  let inString = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && inString) i++
    else if (ch === '"') inString = !inString
    else if (!inString && ch === '/' && line[i + 1] === '/')
      return line.slice(0, i)
  }
  return line
}

/**
 * Index a schema.prisma by DATABASE names: tables (model or `@@map`), their
 * columns (scalar/enum fields, or `@map`), and enums with their db values.
 * Relation fields (typed as another model) are not columns and are skipped.
 */
export function parsePrismaSchema(text: string): SchemaIndex {
  const blocks = [...text.matchAll(/^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
  const enumNames = new Set(blocks.filter(b => b[1] === 'enum').map(b => b[2]!))
  const index: SchemaIndex = { tables: new Map(), enums: new Map() }

  for (const [, kind, name, body] of blocks) {
    const lines = body!
      .split('\n')
      .map(l => stripLineComment(l).trim())
      .filter(Boolean)
    const blockMap = lines
      .map(l => /^@@map\(\s*(?:name:\s*)?"([^"]+)"/.exec(l)?.[1])
      .find(Boolean)

    if (kind === 'enum') {
      const values = new Set<string>()
      for (const l of lines) {
        if (l.startsWith('@@')) continue
        const m = /^(\w+)(?:.*?@map\(\s*(?:name:\s*)?"([^"]+)"\))?/.exec(l)
        if (m) values.add(m[2] ?? m[1]!)
      }
      index.enums.set(blockMap ?? name!, { name: name!, values })
      continue
    }

    const columns = new Map<string, { field: string; ignored: boolean }>()
    for (const l of lines) {
      if (l.startsWith('@@')) continue
      const m = /^(\w+)\s+([\w]+)(\(.*?\))?(\[\])?\??(.*)$/.exec(l)
      if (!m) continue
      const [, field, type, , , rest] = m
      const isColumn =
        SCALAR_TYPES.has(type!) ||
        enumNames.has(type!) ||
        type === 'Unsupported'
      if (!isColumn) continue
      const mapped = /@map\(\s*(?:name:\s*)?"([^"]+)"\)/.exec(rest ?? '')?.[1]
      columns.set(mapped ?? field!, {
        field: field!,
        ignored: /@ignore\b/.test(rest ?? ''),
      })
    }
    index.tables.set(blockMap ?? name!, {
      model: name!,
      ignored: lines.some(l => /^@@ignore\b/.test(l)),
      columns,
    })
  }
  return index
}

// ─── Checking ───────────────────────────────────────────────────────────────

/** True when the SQL carries `-- lumo:contract-phase <reason>` (reason required). */
export function hasContractMarker(sql: string): boolean {
  return new RegExp(String.raw`--\s*${CONTRACT_MARKER}[ \t]+\S`).test(sql)
}

/** Why the base (currently-deployed) code still depends on this op, or null. */
export function stillReferenced(
  op: DestructiveOp,
  base: SchemaIndex
): string | null {
  switch (op.kind) {
    case 'dropColumn':
    case 'renameColumn': {
      const t = base.tables.get(op.table)
      const c = t?.columns.get(op.column)
      if (!t || t.ignored || !c || c.ignored) return null
      return `column "${op.table}"."${op.column}" is still mapped by ${t.model}.${c.field}`
    }
    case 'dropTable':
    case 'renameTable': {
      const t = base.tables.get(op.table)
      if (!t || t.ignored) return null
      return `table "${op.table}" is still mapped by model ${t.model}`
    }
    case 'dropType':
    case 'renameType': {
      const e = base.enums.get(op.type)
      if (!e) return null
      return `enum type "${op.type}" is still mapped by enum ${e.name}`
    }
    case 'recreateEnum': {
      const e = base.enums.get(op.type)
      if (!e) return null
      const kept = new Set(op.values)
      const removed = [...e.values].filter(v => !kept.has(v))
      if (removed.length === 0) return null
      return `enum ${e.name} still has value(s) ${removed.join(', ')} that this migration removes`
    }
    case 'renameEnumValue': {
      const e = base.enums.get(op.type)
      if (!e || !e.values.has(op.value)) return null
      return `enum ${e.name} still has value ${op.value} that this migration renames`
    }
  }
}

/**
 * Judge one migration against the base revision's schema.
 * `base` = null skips the reference check (marker check still applies).
 */
export function checkMigration(
  migration: string,
  sql: string,
  base: SchemaIndex | null
): Violation[] {
  const ops = extractDestructiveOps(sql)
  if (ops.length === 0) return []
  const violations: Violation[] = []
  if (!hasContractMarker(sql)) {
    violations.push({
      migration,
      kind: 'missing-marker',
      message: `contains schema-breaking SQL but no "-- ${CONTRACT_MARKER} <reason>" marker`,
    })
  }
  if (base) {
    for (const op of ops) {
      const why = stillReferenced(op, base)
      if (why)
        violations.push({ migration, kind: 'still-referenced', message: why })
    }
  }
  return violations
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

export function listMigrations(root: string): string[] {
  const dir = join(root, MIGRATIONS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(d => existsSync(join(dir, d, 'migration.sql')))
    .sort()
}

export type RunOptions = {
  root?: string
  base?: string
  write?: (s: string) => void
}

/** Exit code: 0 = clean, 1 = violations or the base ref is unreadable (fail closed). */
export function run(opts: RunOptions = {}): number {
  const root = opts.root ?? process.cwd()
  const baseRef = opts.base ?? 'origin/main'
  const write = opts.write ?? ((s: string) => process.stderr.write(s))

  let baseMigrations: Set<string>
  let baseSchema: SchemaIndex
  try {
    baseMigrations = new Set(
      git(
        ['ls-tree', '-d', '--name-only', `${baseRef}:${MIGRATIONS_DIR}`],
        root
      )
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    )
    baseSchema = parsePrismaSchema(
      git(['show', `${baseRef}:${SCHEMA_PATH}`], root)
    )
  } catch {
    write(
      `✖ [migration-guard] cannot read ${baseRef} — run \`git fetch origin\` (or pass --base <ref>) and retry.\n`
    )
    return 1
  }

  const fresh = listMigrations(root).filter(m => !baseMigrations.has(m))
  const violations = fresh.flatMap(m =>
    checkMigration(
      m,
      readFileSync(join(root, MIGRATIONS_DIR, m, 'migration.sql'), 'utf8'),
      baseSchema
    )
  )
  if (violations.length === 0) return 0

  write(
    `✖ [migration-guard] destructive migration(s) would break the code ${baseRef} is serving:\n`
  )
  for (const v of violations) write(`  - ${v.migration}: ${v.message}\n`)
  write(
    '  Two-phase rule: first ship a release where the code no longer reads/writes it\n' +
      '  (remove the field or mark it @ignore / @@ignore), deploy it, then drop it in a\n' +
      `  later migration marked "-- ${CONTRACT_MARKER} <reason>". See docs/database-migrations.md.\n`
  )
  return 1
}

if (process.argv[1] && process.argv[1].endsWith('destructive-guard.ts')) {
  const i = process.argv.indexOf('--base')
  const base = i !== -1 ? process.argv[i + 1] : undefined
  process.exit(run(base ? { base } : {}))
}
