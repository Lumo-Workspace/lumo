/**
 * LUM-682: prod deploy must apply `prisma migrate deploy` BEFORE the new app
 * code serves traffic.
 *
 * Root cause of two prod incidents (LUM-669 revision column, LUM-678 Initiative
 * reshape): a migration was merged but never applied to prod before the code
 * that expected the new column/enum went live → ColumnNotFound → 500. The
 * deploy pipeline (`build = prisma generate && next build`) never ran
 * `migrate deploy`, so migration application was a manual, unsustainable
 * operator step.
 *
 * These are AGENT_CONSTRUCTED_STATE guards: they read the version-controlled
 * deploy config (vercel.json + the build-gate script) and assert, by static
 * analysis, that the gate is wired the way the contract requires. They do NOT
 * touch prod — the PENDING_OUTCOME criterion covers the next real deploy.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

/** Parsed vercel.json. */
function vercelJson(): { buildCommand?: string } {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'vercel.json'), 'utf8'))
}

const GATE_SCRIPT_REL = 'scripts/deploy/vercel-build.sh'

/** Raw text of the build-gate shell script. */
function gateScript(): string {
  return readFileSync(join(REPO_ROOT, GATE_SCRIPT_REL), 'utf8')
}

describe('LUM-682 prod migrate-deploy gate', () => {
  it('prod deploy runs migrate deploy before serving', () => {
    // 1. Vercel's build command is the version-controlled gate — not the
    //    default `next build`, and not a dashboard-only setting that can drift.
    const { buildCommand } = vercelJson()
    expect(buildCommand).toBeTruthy()
    expect(buildCommand).toContain(GATE_SCRIPT_REL)

    // 2. The gate actually invokes `prisma migrate deploy`.
    const script = gateScript()
    expect(script).toMatch(/prisma\s+migrate\s+deploy/)

    // 3. It builds the app that serves traffic (`next build`, via `npm run
    //    build`). Assert both markers are present so ordering is meaningful.
    const migrateAt = script.search(/prisma\s+migrate\s+deploy/)
    const buildAt = script.search(/npm\s+run\s+build|next\s+build/)
    expect(migrateAt).toBeGreaterThanOrEqual(0)
    expect(buildAt).toBeGreaterThanOrEqual(0)

    // 4. Migrations are applied AHEAD of the code that depends on them:
    //    `migrate deploy` precedes the app build in the script.
    expect(migrateAt).toBeLessThan(buildAt)
  })

  it('deploy blocks or alerts on pending prod migrations', () => {
    const script = gateScript()

    // Fail-closed: the script aborts on any error (`set -e`) so a failed or
    // blocked `migrate deploy` fails the Vercel build → the new code that
    // expects the not-yet-applied schema never ships.
    expect(script).toMatch(/set\s+-[a-z]*e[a-z]*/)

    // A post-apply drift check (`prisma migrate status`) so a still-pending
    // migration surfaces as a hard failure / alert rather than silently
    // shipping code ahead of its schema.
    expect(script).toMatch(/prisma\s+migrate\s+status/)

    // The migrate gate is scoped to the production deploy environment.
    expect(script).toMatch(/VERCEL_ENV/)
  })
})
