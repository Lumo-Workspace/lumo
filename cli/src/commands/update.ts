import { spawn, spawnSync } from 'child_process'
import * as fs from 'fs'
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
  /** `npm root -g` — where `npm install -g` just put the package. */
  globalRoot?: () => string | null
}

export async function update(deps: UpdateDeps = {}): Promise<number> {
  const pkg =
    deps.pkg ??
    (require(path.resolve(__dirname, '../../../..', 'package.json')) as Pkg)
  const fetchLatest = deps.fetchLatest ?? fetchLatestVersion
  const run = deps.run ?? runInherited
  const syncInProcess = deps.syncInProcess ?? (() => skillSync())
  const globalRoot = deps.globalRoot ?? npmGlobalRoot

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
  // freshly installed package is the one that has the new skill files. Run
  // its entry point directly: a bare `lumo` on PATH may be another install
  // (npm link, a different prefix) than the one npm just upgraded.
  const entry = installedEntry(globalRoot(), pkg.name)
  if (!entry) {
    process.stderr.write(
      '\nCould not locate the newly installed CLI. Run `lumo skill sync` to refresh the skill files.\n'
    )
    return 1
  }
  process.stdout.write('\nRefreshing installed skill files: lumo skill sync\n')
  const syncCode = await run(process.execPath, [entry, 'skill', 'sync'])
  if (syncCode !== 0) {
    process.stderr.write(
      'Could not refresh the skill files. Run `lumo skill sync` manually.\n'
    )
  }
  return syncCode
}

/** The `bin` entry of `pkgName` under a global node_modules root, if present. */
export function installedEntry(
  root: string | null,
  pkgName: string
): string | null {
  if (!root) return null
  const entry = path.join(root, pkgName, 'dist', 'cli', 'src', 'index.js')
  return fs.existsSync(entry) ? entry : null
}

function npmGlobalRoot(): string | null {
  const res = spawnSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (res.error || res.status !== 0) return null
  return res.stdout.trim() || null
}

const runInherited: RunCommand = (cmd, args) =>
  new Promise<number>(resolve => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      // npm is a .cmd shim on Windows; node (process.execPath) is a real exe
      // whose path may contain spaces, so it must not go through a shell.
      shell: process.platform === 'win32' && cmd === 'npm',
    })
    // A signal-terminated child reports code null — that is a failure.
    proc.on('close', code => resolve(code ?? 1))
    proc.on('error', err => {
      process.stderr.write(`Failed to launch ${cmd}: ${err.message}\n`)
      resolve(1)
    })
  })
