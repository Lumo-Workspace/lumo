/**
 * LUM-1085: destructive-migration guard (two-phase expand/contract rule).
 *
 * Incident: #1397 dropped tasks.initiativeId while the previous deployment —
 * whose schema.prisma still mapped Task.initiativeId — was serving, because the
 * deploy gate runs `prisma migrate deploy` before the new build goes live.
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  checkMigration,
  extractDestructiveOps,
  hasContractMarker,
  listMigrations,
  normIdent,
  parsePrismaSchema,
  run,
  splitStatements,
  stillReferenced,
} from '../../scripts/migrations/destructive-guard'

const REPO_ROOT = join(__dirname, '..', '..')

const SCHEMA_WITH_COLUMN = `
model Task {
  id           String      @id
  title        String
  initiativeId String?
  initiative   Initiative? @relation(fields: [initiativeId], references: [id])
  legacyCode   String?     @map("legacy_code")

  @@map("tasks")
}

model Initiative {
  id    String @id
  tasks Task[]

  @@map("initiatives")
}

enum TaskStatus {
  TODO
  DONE
  CANCELED @map("CANCELLED")
}
`

const SCHEMA_COLUMN_REMOVED = `
model Task {
  id    String @id
  title String

  @@map("tasks")
}

enum TaskStatus {
  TODO
  DONE
  CANCELED @map("CANCELLED")
}
`

const SCHEMA_COLUMN_IGNORED = `
model Task {
  id           String  @id
  title        String
  initiativeId String? @ignore

  @@map("tasks")
}

model Initiative {
  id String @id

  @@map("initiatives")
  @@ignore
}
`

// The exact SQL shape `prisma migrate dev` emitted for #1397.
const DROP_COLUMN_SQL = `-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_initiativeId_fkey";

-- DropIndex
DROP INDEX "tasks_initiativeId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "initiativeId";
`
const MARKED = `-- lumo:contract-phase expand shipped in #1400\n${DROP_COLUMN_SQL}`

describe('destructive-migration guard', () => {
  describe('SQL extraction', () => {
    it('recognizes Prisma-generated DROP COLUMN / DROP TABLE / DROP TYPE forms', () => {
      const ops = extractDestructiveOps(`
        ALTER TABLE "tasks" DROP COLUMN "initiativeId";
        ALTER TABLE "public"."sessions" DROP COLUMN "summary",
        DROP COLUMN IF EXISTS "summaryModel",
        ADD COLUMN "x" TEXT;
        DROP TABLE "initiative_updates";
        DROP TABLE IF EXISTS "a", "b" CASCADE;
        DROP TYPE "InitiativeHealth";
      `)
      expect(
        ops.map(o => [o.kind, 'column' in o ? `${o.table}.${o.column}` : o])
      ).toEqual([
        ['dropColumn', 'tasks.initiativeId'],
        ['dropColumn', 'sessions.summary'],
        ['dropColumn', 'sessions.summaryModel'],
        ['dropTable', expect.objectContaining({ table: 'initiative_updates' })],
        ['dropTable', expect.objectContaining({ table: 'a' })],
        ['dropTable', expect.objectContaining({ table: 'b' })],
        ['dropType', expect.objectContaining({ type: 'InitiativeHealth' })],
      ])
    })

    it('recognizes renames and the enum-recreate pattern, ignoring constraints/indexes', () => {
      const ops = extractDestructiveOps(`
        ALTER TABLE "tasks" DROP CONSTRAINT "tasks_x_fkey";
        ALTER TABLE "projects" RENAME COLUMN "defaultReviewerId" TO "ownerId";
        ALTER TABLE "old_t" RENAME TO "new_t";
        DROP INDEX "tasks_x_idx";
        BEGIN;
        CREATE TYPE "TaskStatus_new" AS ENUM ('TODO', 'DONE');
        ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
        ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
        ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";
        DROP TYPE "public"."TaskStatus_old";
        COMMIT;
        ALTER TYPE "CommentType" RENAME VALUE 'user' TO 'USER';
      `)
      expect(ops.map(o => o.kind)).toEqual([
        'renameColumn',
        'renameTable',
        'recreateEnum',
        'renameEnumValue',
      ])
      expect(ops[2]).toMatchObject({
        type: 'TaskStatus',
        values: ['TODO', 'DONE'],
      })
    })

    it('does not scan comments or dollar-quoted function bodies', () => {
      const ops = extractDestructiveOps(`
        -- ALTER TABLE "tasks" DROP COLUMN "commented";
        /* DROP TABLE "blocked"; */
        CREATE FUNCTION f() RETURNS trigger AS $$
        BEGIN
          EXECUTE 'ALTER TABLE tasks DROP COLUMN x';
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        ALTER TABLE "tasks" ADD COLUMN "y" TEXT;
      `)
      expect(ops).toEqual([])
    })

    it('splits statements and normalizes identifiers', () => {
      expect(splitStatements(`SELECT ';'; SELECT 1`)).toEqual([
        `SELECT ';'`,
        'SELECT 1',
      ])
      expect(normIdent('"public"."Tasks"')).toBe('Tasks')
      expect(normIdent('public.Tasks')).toBe('tasks')
    })
  })

  describe('schema index', () => {
    it('maps tables, columns (@map), relation fields and enum db values', () => {
      const idx = parsePrismaSchema(SCHEMA_WITH_COLUMN)
      const tasks = idx.tables.get('tasks')!
      expect(tasks.model).toBe('Task')
      expect(tasks.columns.has('initiativeId')).toBe(true)
      expect(tasks.columns.has('legacy_code')).toBe(true)
      expect(tasks.columns.has('initiative')).toBe(false) // relation, not a column
      expect([...idx.enums.get('TaskStatus')!.values]).toEqual([
        'TODO',
        'DONE',
        'CANCELLED',
      ])
    })

    it('records @ignore / @@ignore', () => {
      const idx = parsePrismaSchema(SCHEMA_COLUMN_IGNORED)
      expect(
        idx.tables.get('tasks')!.columns.get('initiativeId')!.ignored
      ).toBe(true)
      expect(idx.tables.get('initiatives')!.ignored).toBe(true)
    })
  })

  describe('checkMigration (the two-phase rule)', () => {
    it('fails a DROP COLUMN while the base code still maps the column (the #1397 case)', () => {
      const v = checkMigration(
        'm',
        MARKED,
        parsePrismaSchema(SCHEMA_WITH_COLUMN)
      )
      expect(v).toEqual([
        expect.objectContaining({
          kind: 'still-referenced',
          message: expect.stringContaining('Task.initiativeId'),
        }),
      ])
    })

    it('passes once the base code no longer references the column', () => {
      expect(
        checkMigration('m', MARKED, parsePrismaSchema(SCHEMA_COLUMN_REMOVED))
      ).toEqual([])
    })

    it('passes when the base code only keeps it as @ignore / @@ignore', () => {
      const sql = `${MARKED}\nDROP TABLE "initiatives";`
      expect(
        checkMigration('m', sql, parsePrismaSchema(SCHEMA_COLUMN_IGNORED))
      ).toEqual([])
    })

    it('requires the contract-phase marker with a reason', () => {
      const v = checkMigration(
        'm',
        DROP_COLUMN_SQL,
        parsePrismaSchema(SCHEMA_COLUMN_REMOVED)
      )
      expect(v.map(x => x.kind)).toEqual(['missing-marker'])
      expect(hasContractMarker('-- lumo:contract-phase')).toBe(false)
      expect(hasContractMarker('-- lumo:contract-phase expand=#1400')).toBe(
        true
      )
    })

    it('ignores additive migrations entirely', () => {
      const sql =
        'ALTER TABLE "tasks" ADD COLUMN "z" TEXT;\nCREATE INDEX "i" ON "tasks"("z");'
      expect(
        checkMigration('m', sql, parsePrismaSchema(SCHEMA_WITH_COLUMN))
      ).toEqual([])
    })

    it('flags tables, enum types, renames and removed enum values the base still maps', () => {
      const base = parsePrismaSchema(SCHEMA_WITH_COLUMN)
      const msg = (sql: string) =>
        checkMigration('m', `-- lumo:contract-phase r\n${sql}`, base).map(
          v => v.message
        )
      expect(msg('DROP TABLE "initiatives";')).toEqual([
        expect.stringContaining('model Initiative'),
      ])
      expect(msg('DROP TYPE "TaskStatus";')).toEqual([
        expect.stringContaining('enum TaskStatus'),
      ])
      expect(
        msg('ALTER TABLE "tasks" RENAME COLUMN "title" TO "name";')
      ).toEqual([expect.stringContaining('Task.title')])
      expect(
        msg(`CREATE TYPE "TaskStatus_new" AS ENUM ('TODO', 'DONE');`)
      ).toEqual([expect.stringContaining('CANCELLED')])
      expect(
        msg(
          `CREATE TYPE "TaskStatus_new" AS ENUM ('TODO', 'DONE', 'CANCELLED');`
        )
      ).toEqual([])
    })

    it('skips the reference check when no base schema is available', () => {
      expect(
        stillReferenced(
          { kind: 'dropTable', table: 'x', statement: '' },
          parsePrismaSchema('')
        )
      ).toBeNull()
      expect(checkMigration('m', MARKED, null)).toEqual([])
    })
  })

  describe('run() against a git base ref', () => {
    let dir: string
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

    /** Write a file into the temp working tree. */
    const put = (path: string, content: string) => {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), content)
    }

    /** Commit `schema` + one old migration as ref `base` without running hooks. */
    const makeBase = (schema: string) => {
      put('prisma/schema.prisma', schema)
      put(
        'prisma/migrations/20260101000000_init/migration.sql',
        'CREATE TABLE "tasks" ();'
      )
      git('add', '-A')
      const tree = git('write-tree')
      const commit = execFileSync('git', ['commit-tree', tree, '-m', 'base'], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@example.com',
        },
      }).trim()
      git('update-ref', 'refs/heads/base', commit)
    }

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'lum1085-'))
      git('init', '-q')
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it('exits 1 when a new migration drops a column the base still maps', () => {
      makeBase(SCHEMA_WITH_COLUMN)
      put('prisma/migrations/20261101000000_drop/migration.sql', MARKED)
      const out: string[] = []
      expect(run({ root: dir, base: 'base', write: s => out.push(s) })).toBe(1)
      expect(out.join('')).toContain('20261101000000_drop')
      expect(out.join('')).toContain('Task.initiativeId')
    })

    it('exits 0 once the base no longer maps it, and never re-judges base migrations', () => {
      makeBase(SCHEMA_COLUMN_REMOVED)
      put('prisma/migrations/20261101000000_drop/migration.sql', MARKED)
      // An old, unmarked destructive migration already in base is not re-judged.
      put(
        'prisma/migrations/20260101000000_init/migration.sql',
        DROP_COLUMN_SQL
      )
      expect(run({ root: dir, base: 'base', write: () => {} })).toBe(0)
    })

    it('warns and exits 0 when the base ref cannot be read', () => {
      const out: string[] = []
      expect(run({ root: dir, base: 'nope', write: s => out.push(s) })).toBe(0)
      expect(out.join('')).toContain('git fetch origin')
    })
  })

  describe('repo invariant', () => {
    const baseline: string[] = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'scripts/migrations/destructive-baseline.json'),
        'utf8'
      )
    ).migrations

    it('every destructive migration after the baseline carries the contract-phase marker', () => {
      const frozen = new Set(baseline)
      const unmarked = listMigrations(REPO_ROOT).filter(m => {
        if (frozen.has(m)) return false
        const sql = readFileSync(
          join(REPO_ROOT, 'prisma/migrations', m, 'migration.sql'),
          'utf8'
        )
        return checkMigration(m, sql, null).length > 0
      })
      expect(unmarked).toEqual([])
    })

    it('the frozen baseline only names real migrations', () => {
      const all = new Set(listMigrations(REPO_ROOT))
      expect(baseline.filter(m => !all.has(m))).toEqual([])
    })
  })
})
