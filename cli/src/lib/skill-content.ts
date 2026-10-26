import * as fs from 'fs'
import * as path from 'path'

/**
 * LUM-1292: the Lumo skill is never installed anywhere — its content is
 * served from the npm package's `skill/` dir by `lumo skill read [path]`.
 * Source of truth: `cli/skill/` (shipped as `skill/` in the package).
 */

const PACKAGE_NAME = '@lumoai/cli'

export const SKILL_READ_FOOTER =
  'Read any other file of this guide with `lumo skill read <path>` (e.g. `lumo skill read references/tasks.md`).'

/**
 * Absolute path of the package's `skill/` dir. Walks up from `fromDir` to the
 * nearest `@lumoai/cli` package.json (the source tree and `dist/cli/src/lib`
 * sit at different depths, so no fixed `../..` count works for both).
 */
export function skillRoot(fromDir: string = __dirname): string {
  let dir = fromDir
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
      ) as { name?: unknown }
      if (pkg.name === PACKAGE_NAME) return path.join(dir, 'skill')
    } catch {
      // no readable package.json at this level — keep walking up
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not locate the ${PACKAGE_NAME} package root`)
}

export type SkillFileResult =
  | { ok: true; content: string }
  | { ok: false; error: 'not-found' | 'outside' }

/** Read `rel` (default `SKILL.md`) under `root`; anything resolving outside it is refused. */
export function readSkillFile(
  rel: string = 'SKILL.md',
  root: string = skillRoot()
): SkillFileResult {
  const base = path.resolve(root)
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep))
    return { ok: false, error: 'outside' }
  // `references/../../x` normalizes outside the root, but a literal `..`
  // segment is refused even when it would land back inside.
  if (rel.split(/[\\/]/).includes('..')) return { ok: false, error: 'outside' }
  try {
    const stat = fs.statSync(target)
    if (!stat.isFile()) return { ok: false, error: 'not-found' }
    return { ok: true, content: fs.readFileSync(target, 'utf8') }
  } catch {
    return { ok: false, error: 'not-found' }
  }
}

/** Skill files as root-relative POSIX paths (for the not-found hint). */
export function listSkillFiles(root: string = skillRoot()): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile())
        out.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  try {
    walk(root)
  } catch {
    // unreadable root — empty list
  }
  return out.sort()
}
