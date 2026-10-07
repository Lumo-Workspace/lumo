import { spawn } from 'child_process'
import * as path from 'path'
import { fetchLatestVersion, isNewer } from '../lib/update-check'
import { skillSync } from './skill-sync'

type Pkg = { name: string; version: string }

/** Run a command with inherited stdio; resolves its exit code (1 if it can't launch). */
export type RunCommand = (cmd: string, args: string[]) => Promise<number>

export interface UpdateDeps {
  pkg?: Pkg
  fetchLatest?: typeof fetchLatestVersion
  run?: RunCommand
  syncInProcess?: () => Promise<number>
}

export async function update(deps: UpdateDeps = {}): Promise<number> {
  const pkg =
    deps.pkg ??
    (require(path.resolve(__dirname, '../../../..', 'package.json')) as Pkg)
  const fetchLatest = deps.fetchLatest ?? fetchLatestVersion
  const run = deps.run ?? runInherited
  const syncInProcess = deps.syncInProcess ?? (() => skillSync())

  process.stdout.write(`Current: ${pkg.name}@${pkg.version}\n`)
  process.stdout.write('Checking npm registry...\n')

  const latest = await fetchLatest(pkg.name, 5000)
  if (!latest) {
    process.stderr.write(
      'Could not reach npm registry. Check your connection and try again.\n'
    )
    return 1
  }

  // LUM-1042: no upgrade to run, but the installed skill copies may still
  // lag this CLI (e.g. it was upgraded with a bare `npm install -g`).
  if (latest === pkg.version) {
    process.stdout.write(`Already on the latest version (${latest}).\n\n`)
    return syncInProcess()
  }

  if (!isNewer(pkg.version, latest)) {
    process.stdout.write(
      `Installed version (${pkg.version}) is ahead of the published latest (${latest}). Nothing to do.\n\n`
    )
    return syncInProcess()
  }

  process.stdout.write(`Latest:  ${pkg.name}@${latest}\n\n`)
  process.stdout.write(`Running: npm install -g ${pkg.name}@latest\n\n`)

  const code = await run('npm', ['install', '-g', `${pkg.name}@latest`])
  if (code !== 0) {
    process.stderr.write(
      `Fallback: run \`npm install -g ${pkg.name}@latest\` manually.\n`
    )
    return code
  }

  // This process is still the old CLI carrying the old skill bundle — the
  // freshly installed binary is the one that has the new skill files.
  process.stdout.write('\nRefreshing installed skill files: lumo skill sync\n')
  const syncCode = await run('lumo', ['skill', 'sync'])
  if (syncCode !== 0) {
    process.stderr.write(
      'Could not refresh the skill files. Run `lumo skill sync` manually.\n'
    )
  }
  return syncCode
}

const runInherited: RunCommand = (cmd, args) =>
  new Promise<number>(resolve => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    proc.on('close', code => resolve(code ?? 0))
    proc.on('error', err => {
      process.stderr.write(`Failed to launch ${cmd}: ${err.message}\n`)
      resolve(1)
    })
  })
