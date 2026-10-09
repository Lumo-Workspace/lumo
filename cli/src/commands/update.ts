import { spawn } from 'child_process'
import * as path from 'path'
import {
  describeAutoUpdate,
  getAutoUpdateStatus,
  isAutoUpdateInProgress,
  writeAutoUpdateSetting,
} from '../lib/auto-update'
import { fetchLatestVersion, isNewer } from '../lib/update-check'

type Pkg = { name: string; version: string }

export async function update(options: { auto?: string } = {}): Promise<number> {
  if (options.auto !== undefined) {
    if (options.auto !== 'on' && options.auto !== 'off') {
      process.stderr.write('Error: --auto must be "on" or "off".\n')
      return 1
    }
    writeAutoUpdateSetting(options.auto === 'on')
    process.stdout.write(`${describeAutoUpdate(getAutoUpdateStatus())}\n`)
    return 0
  }

  if (isAutoUpdateInProgress()) {
    process.stderr.write(
      'Not updating: a background update is in progress — try again in a minute.\n'
    )
    return 1
  }

  const pkg = require(
    path.resolve(__dirname, '../../../..', 'package.json')
  ) as Pkg

  process.stdout.write(`Current: ${pkg.name}@${pkg.version}\n`)
  process.stdout.write(`${describeAutoUpdate(getAutoUpdateStatus())}\n`)
  process.stdout.write('Checking npm registry...\n')

  const latest = await fetchLatestVersion(pkg.name, 5000)
  if (!latest) {
    process.stderr.write(
      'Could not reach npm registry. Check your connection and try again.\n'
    )
    return 1
  }

  if (latest === pkg.version) {
    process.stdout.write(`Already on the latest version (${latest}).\n`)
    return 0
  }

  if (!isNewer(pkg.version, latest)) {
    process.stdout.write(
      `Installed version (${pkg.version}) is ahead of the published latest (${latest}). Nothing to do.\n`
    )
    return 0
  }

  process.stdout.write(`Latest:  ${pkg.name}@${latest}\n\n`)
  process.stdout.write(`Running: npm install -g ${pkg.name}@latest\n\n`)

  return new Promise<number>(resolve => {
    const proc = spawn('npm', ['install', '-g', `${pkg.name}@latest`], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    proc.on('close', code => resolve(code ?? 0))
    proc.on('error', err => {
      process.stderr.write(`Failed to launch npm: ${err.message}\n`)
      process.stderr.write(
        `Fallback: run \`npm install -g ${pkg.name}@latest\` manually.\n`
      )
      resolve(1)
    })
  })
}
