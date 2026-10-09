import * as fs from 'fs'
import * as path from 'path'

const PACKAGE_NAME = '@lumoai/cli'

/**
 * The installed CLI's version, found by walking up from this module to the
 * `@lumoai/cli` package.json (the compiled depth differs from the source
 * depth, so no fixed `../..` count works for both). Null when not found —
 * callers render nothing rather than a guess.
 */
export function readCliVersion(startDir: string = __dirname): string | null {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'package.json')
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
        name?: unknown
        version?: unknown
      }
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string')
        return pkg.version
    } catch {
      // no readable package.json at this level — keep walking up
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Directory of the running `@lumoai/cli` package (the one holding its
 * package.json), found by walking up from `startDir`. Null when not found.
 */
export function findCliPackageRoot(
  startDir: string = __dirname
): string | null {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
      ) as { name?: unknown }
      if (pkg.name === PACKAGE_NAME) return dir
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
