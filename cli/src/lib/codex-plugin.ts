import * as fs from 'fs'
import * as path from 'path'

/**
 * LUM-1049: the npm package root doubles as a portable Agent Plugins package
 * (https://developers.openai.com/plugins/build/plugins), so a Codex / ChatGPT
 * marketplace can reference `@lumoai/cli` with an `npm` source. The package
 * root carries `plugin.json` plus `skills/lumo/` — both generated at build
 * time from `.claude/skills/lumo/` (the single source) and package.json, so
 * neither can drift from what `lumo init` installs.
 */

export const AGENT_PLUGINS_SCHEMA =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'

/** Where the bundled skill lives, relative to the CLI package root. */
export const BUNDLED_SKILL_REL = path.join('skills', 'lumo')

type PackageMeta = {
  version: string
  license?: string
}

export type PluginManifest = {
  $schema: string
  name: string
  version: string
  description: string
  author: { name: string; url: string }
  homepage: string
  license?: string
  keywords: string[]
  extensions: {
    'com.openai': {
      interface: {
        displayName: string
        shortDescription: string
        developerName: string
        category: string
        websiteURL: string
      }
    }
  }
}

const SHORT_DESCRIPTION =
  'Lumo tasks, docs, milestones and PR security scans from your coding agent.'

export function buildPluginManifest(pkg: PackageMeta): PluginManifest {
  return {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: 'lumo',
    version: pkg.version,
    description: SHORT_DESCRIPTION,
    author: { name: 'Lumo', url: 'https://www.uselumo.ai' },
    homepage: 'https://www.uselumo.ai',
    ...(pkg.license ? { license: pkg.license } : {}),
    keywords: ['lumo', 'project-management', 'tasks'],
    extensions: {
      'com.openai': {
        interface: {
          displayName: 'Lumo',
          shortDescription: SHORT_DESCRIPTION,
          developerName: 'Lumo',
          category: 'Productivity',
          websiteURL: 'https://www.uselumo.ai',
        },
      },
    },
  }
}

/** Recursively list files under `dir` as paths relative to `base`. */
export function listFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full))
  }
  return out.sort()
}

/**
 * Where the bundled skill lives on disk. `fromDir` is the compiled module dir
 * (`<pkg>/dist/cli/src/lib`), four levels below the package root.
 */
export function bundledSkillDir(fromDir: string = __dirname): string {
  return path.resolve(fromDir, '../../../..', BUNDLED_SKILL_REL)
}

const STAGING_PREFIX = '.lumo-staging-'
const BACKUP_PREFIX = '.lumo-backup-'
const STALE_SIBLING_MS = 60 * 60 * 1000

/**
 * Remove `.lumo-staging-*` / `.lumo-backup-*` dirs in `parent` older than an
 * hour — leftovers of a killed process. Fresh ones may belong to a live peer.
 * When `dst` is given and missing (a crash between the swap's two renames),
 * the newest stale backup is restored to `dst` instead of being deleted.
 */
export function cleanStaleSwapDirs(
  parent: string,
  now: number = Date.now(),
  dst?: string
): void {
  let names: string[]
  try {
    names = fs.readdirSync(parent)
  } catch {
    return
  }
  const stale: { full: string; mtimeMs: number; isBackup: boolean }[] = []
  for (const name of names) {
    const isBackup = name.startsWith(BACKUP_PREFIX)
    if (!name.startsWith(STAGING_PREFIX) && !isBackup) continue
    const full = path.join(parent, name)
    try {
      const mtimeMs = fs.statSync(full).mtimeMs
      if (now - mtimeMs > STALE_SIBLING_MS)
        stale.push({ full, mtimeMs, isBackup })
    } catch {
      // best effort
    }
  }
  let restore: string | null = null
  if (dst !== undefined && !fs.existsSync(dst)) {
    const newest = stale
      .filter(s => s.isBackup)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (newest) {
      try {
        fs.renameSync(newest.full, dst)
        restore = newest.full
      } catch {
        // best effort — leave the backup for the next run
        restore = newest.full
      }
    }
  }
  for (const s of stale) {
    if (s.full === restore) continue
    try {
      fs.rmSync(s.full, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
}

/**
 * Replace `dst` with a copy of `src`. Copies into a dot-prefixed staging
 * sibling (never loadable as a skill), then swaps: dst -> backup, staging ->
 * dst, drop backup. If the second rename fails the backup is renamed back, so
 * at no point are both copies gone. Returns the relative file list.
 */
export function copySkillTree(src: string, dst: string): string[] {
  const files = listFiles(src)
  const parent = path.dirname(dst)
  const staging = path.join(parent, `${STAGING_PREFIX}${process.pid}`)
  const backup = path.join(parent, `${BACKUP_PREFIX}${process.pid}`)
  fs.mkdirSync(parent, { recursive: true })
  cleanStaleSwapDirs(parent, Date.now(), dst)
  try {
    fs.rmSync(staging, { recursive: true, force: true })
    for (const rel of files) {
      const to = path.join(staging, rel)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(path.join(src, rel), to)
    }
    let backedUp = false
    if (fs.existsSync(dst)) {
      fs.rmSync(backup, { recursive: true, force: true })
      fs.renameSync(dst, backup)
      backedUp = true
      // rename keeps dst's old mtime; stamp the swap time so the age-based
      // cleanup never mistakes a just-made backup for a stale leftover.
      const swapped = new Date()
      fs.utimesSync(backup, swapped, swapped)
    }
    try {
      fs.renameSync(staging, dst)
    } catch (err) {
      if (backedUp) fs.renameSync(backup, dst)
      throw err
    }
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true })
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
  return files
}

/**
 * Write the plugin bundle into `packageRoot`: a fresh copy of `skillSrcDir`
 * at `skills/lumo/` (stale files removed first) and `plugin.json`.
 */
export function writePluginBundle(
  skillSrcDir: string,
  packageRoot: string,
  pkg: PackageMeta
): { skillFiles: string[] } {
  if (!fs.existsSync(path.join(skillSrcDir, 'SKILL.md'))) {
    throw new Error(`cannot find SKILL.md under ${skillSrcDir}`)
  }
  const skillDst = path.join(packageRoot, BUNDLED_SKILL_REL)
  const skillFiles = copySkillTree(skillSrcDir, skillDst)
  fs.writeFileSync(
    path.join(packageRoot, 'plugin.json'),
    JSON.stringify(buildPluginManifest(pkg), null, 2) + '\n'
  )
  return { skillFiles }
}
