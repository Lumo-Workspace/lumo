/**
 * LUM-1138: `pull_requests.reviewRoundLimit` is no longer read (LUM-1137). The
 * expand release (#1478) kept it out of every Prisma query with `@ignore`; the
 * contract release drops the column and the field. Either way no runtime code
 * may name it and the destructive guard must accept the DROP COLUMN.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

import {
  parsePrismaSchema,
  stillReferenced,
} from '../../scripts/migrations/destructive-guard'

const REPO_ROOT = join(__dirname, '..', '..')
const COLUMN = 'reviewRoundLimit'

// Runtime code roots. Tests are excluded: the LUM-1137 migration test inserts
// the column with raw SQL to exercise that migration's historical backfill.
const CODE_ROOTS = [
  'app',
  'cli/src',
  'components',
  'constants',
  'ee',
  'hooks',
  'lib',
  'mcp',
  'oss',
  'shared',
  'types',
  'proxy.ts',
  'instrumentation.ts',
]
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '__tests__'])
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql)$/

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return SOURCE_EXT.test(path) ? [path] : []
  return readdirSync(path)
    .filter(name => !SKIP_DIRS.has(name))
    .flatMap(name => sourceFiles(join(path, name)))
}

describe('LUM-1138 PullRequest.reviewRoundLimit removal', () => {
  it('no runtime code path names the column', () => {
    const files = CODE_ROOTS.flatMap(root => sourceFiles(join(REPO_ROOT, root)))
    expect(files.length).toBeGreaterThan(100)
    const hits = files
      .filter(f => readFileSync(f, 'utf8').includes(COLUMN))
      .map(f => f.slice(REPO_ROOT.length + 1))
    expect(hits).toEqual([])
  })

  it('schema.prisma no longer has the field (contract phase)', () => {
    const schema = parsePrismaSchema(
      readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
    )
    const table = schema.tables.get('pull_requests')
    expect(table?.model).toBe('PullRequest')
    expect(table?.columns.has(COLUMN)).toBe(false)
    // The destructive guard accepts the contract-phase drop against this schema.
    expect(
      stillReferenced(
        {
          kind: 'dropColumn',
          table: 'pull_requests',
          column: COLUMN,
          statement: `ALTER TABLE "pull_requests" DROP COLUMN "${COLUMN}";`,
        },
        schema
      )
    ).toBeNull()
  })
})
