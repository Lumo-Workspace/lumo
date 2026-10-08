/**
 * LUM-1032 — the bootstrap wrapper refuses a database that
 * @workflow/world-postgres 4.x bootstrapped: drizzle's migrator would skip
 * 0011–0014 on 5.x. The script is plain ESM run by `node` in the runtime
 * image, so its pure helpers are exercised through a real `node` process.
 */
import { execFileSync } from 'child_process'
import { join } from 'path'
import { pathToFileURL } from 'url'

const SCRIPT = pathToFileURL(
  join(__dirname, '..', '..', 'scripts', 'workflow-postgres-bootstrap.mjs')
).href

function call(fn: string, ...args: unknown[]): unknown {
  const code = `const m = await import(${JSON.stringify(SCRIPT)});
process.stdout.write(JSON.stringify(m.${fn}(...${JSON.stringify(args)})))`
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
    })
  )
}

// `when` values from the 5.0.2 journal (src/drizzle/migrations/meta/_journal.json).
const J = (idx: number, when: number) => ({
  tag: `${String(idx).padStart(4, '0')}_m`,
  when,
})
const JOURNAL_5 = [
  J(10, 1771000000000),
  J(11, 1771500000000),
  J(12, 1775600000000),
  J(13, 1779609600000),
  J(14, 1780185600000),
  J(15, 1782691200000),
  J(16, 1784937600000),
]

describe('workflow-postgres-bootstrap.mjs', () => {
  it('LUM-1032: flags 0011–0014 on a database bootstrapped by world-postgres 4.3.9 (0010 + 0015 applied)', () => {
    expect(
      call('skippedWorldMigrations', JOURNAL_5, [1771000000000, 1782691200000])
    ).toEqual(['0011_m', '0012_m', '0013_m', '0014_m'])
  })

  it('LUM-1032: a fresh database or a fully migrated one is not refused', () => {
    expect(call('skippedWorldMigrations', JOURNAL_5, [])).toEqual([])
    expect(
      call(
        'skippedWorldMigrations',
        JOURNAL_5,
        JOURNAL_5.map(e => e.when)
      )
    ).toEqual([])
    // Pending migrations NEWER than the last applied one are the normal upgrade.
    expect(
      call('skippedWorldMigrations', JOURNAL_5, [1771000000000, 1771500000000])
    ).toEqual([])
  })

  it('LUM-1032: the refusal names the skipped migrations, the drain and the three schemas to drop', () => {
    const msg = call('legacyDatabaseMessage', ['0011_m']) as string
    expect(msg).toContain('0011_m')
    expect(msg).toMatch(/Drain/)
    expect(msg).toContain(
      'DROP SCHEMA workflow, workflow_drizzle, graphile_worker CASCADE;'
    )
  })
})
