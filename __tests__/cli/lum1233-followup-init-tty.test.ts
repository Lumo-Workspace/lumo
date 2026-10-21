/**
 * @jest-environment node
 *
 * LUM-1233 follow-up (user ruling 2026-10-19): `lumo init` without `--scope`
 * no longer asks user-or-project on a TTY — it installs for the repo
 * (`--scope project`) and says so in one line. Run through `script`, so the
 * CLI really sees a terminal on stdin and stdout.
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../..')
const TSX = join(ROOT, 'node_modules/.bin/tsx')
const hasScript =
  spawnSync('script', ['-q', '/dev/null', 'true'], { stdio: 'ignore' })
    .status === 0 ||
  spawnSync('script', ['-qec', 'true', '/dev/null'], { stdio: 'ignore' })
    .status === 0

/**
 * Runs `init` from the source through a tiny driver (the CLI entry resolves
 * its package.json from the compiled layout), so the test needs no build.
 */
function underTty(
  options: Record<string, unknown>,
  cwd: string,
  env: NodeJS.ProcessEnv
) {
  const driver = join(
    mkdtempSync(join(tmpdir(), 'lumo-init-tty-driver-')),
    'driver.ts'
  )
  writeFileSync(
    driver,
    `import { init } from ${JSON.stringify(join(ROOT, 'cli/src/commands/init.ts'))}\n` +
      // The skill source stands in for the bundled asset of a built CLI.
      `init(${JSON.stringify(options)}, { bundledSkillDir: ${JSON.stringify(join(ROOT, 'cli/skill'))} })` +
      `.then(code => process.exit(code ?? 0))\n`
  )
  const argv = [TSX, driver]
  // BSD script (macOS): script -q <file> <cmd…>; util-linux: script -qec "<cmd>" <file>.
  const bsd = process.platform === 'darwin'
  const r = bsd
    ? spawnSync('script', ['-q', '/dev/null', ...argv], {
        cwd,
        env,
        encoding: 'utf8',
        // stdin from /dev/null: script still gives the child a terminal, and
        // a question would only ever read EOF.
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90_000,
      })
    : spawnSync('script', ['-qec', argv.join(' '), '/dev/null'], {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90_000,
      })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

;(hasScript ? describe : describe.skip)('init on a TTY without --scope', () => {
  it('defaults to project scope, asks nothing and writes nothing on --dry-run', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lumo-init-tty-repo-'))
    const home = mkdtempSync(join(tmpdir(), 'lumo-init-tty-home-'))
    spawnSync('git', ['init', '-q'], { cwd: repo })
    const env = {
      ...process.env,
      HOME: home,
      LUMO_CONFIG_DIR: join(home, '.lumo'),
      LUMO_NO_UPDATE_CHECK: '1',
    }
    const r = underTty({ agent: 'claude-code', dryRun: true }, repo, env)
    expect(r.out).toContain(
      'No --scope given: installing for this repo (--scope project)'
    )
    expect(r.out).toContain('project scope, nothing is written')
    expect(r.out).not.toMatch(/\[u\/P\]|Install Lumo for \[u\]ser/)
    expect(r.status).toBe(0)
    expect(readdirSync(repo).filter(f => f !== '.git')).toEqual([])
  }, 120_000)
})
