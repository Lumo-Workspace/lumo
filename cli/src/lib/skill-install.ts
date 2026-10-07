import * as fs from 'fs'
import * as path from 'path'
import { configDir } from './config'

/**
 * LUM-1042: the lumo skill's install + refresh mechanics, shared by `setup`
 * (first install), `skill sync` and `update` (refresh).
 *
 * `setup` records every skill directory it installs into in a small registry
 * (`~/.lumo/skill-installs.json`) so a later `update` / `skill sync` can find
 * project-scope installs again — nothing else knows where they are.
 */

/** The skill tree bundled into this CLI package (cli/assets/skill/). */
export function bundledSkillDir(): string {
  // From dist/cli/src/lib/skill-install.js → ../../../../assets/skill
  return path.resolve(__dirname, '../../../..', 'assets', 'skill')
}

/** `<root>/.claude/skills/lumo` for a scope root (home dir or project dir). */
export function skillDirFor(root: string): string {
  return path.join(root, '.claude', 'skills', 'lumo')
}

// Recursively list files under `dir` as paths relative to `base`.
export function listSkillFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSkillFiles(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full))
  }
  return out
}

function filesEqual(src: string, dst: string): boolean {
  if (!fs.existsSync(dst)) return false
  if (fs.statSync(src).size !== fs.statSync(dst).size) return false
  return fs.readFileSync(src).equals(fs.readFileSync(dst))
}

export function hasSkill(skillDir: string): boolean {
  return fs.existsSync(path.join(skillDir, 'SKILL.md'))
}

/** True when every bundled file is present and byte-identical in `skillDir`. */
export function skillMatchesBundle(srcDir: string, skillDir: string): boolean {
  return listSkillFiles(srcDir).every(rel =>
    filesEqual(path.join(srcDir, rel), path.join(skillDir, rel))
  )
}

/**
 * Replace the managed skill in `skillDir` with the bundle: the references/
 * dir is replaced wholesale so stale reference files don't linger. Returns
 * the number of files written.
 */
export function writeSkill(srcDir: string, skillDir: string): number {
  const relFiles = listSkillFiles(srcDir)
  fs.rmSync(path.join(skillDir, 'references'), { recursive: true, force: true })
  for (const rel of relFiles) {
    const dst = path.join(skillDir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(srcDir, rel), dst)
  }
  return relFiles.length
}

/**
 * The Lumo monorepo's own `.claude/skills/lumo/` is the skill's *source*
 * (cli/scripts/bundle-assets.js copies it into the package). A refresh must
 * never overwrite it with a published copy.
 */
export function isLumoSourceCheckout(skillDir: string): boolean {
  const root = path.resolve(skillDir, '..', '..', '..')
  return fs.existsSync(path.join(root, 'cli', 'scripts', 'bundle-assets.js'))
}

// ── Install registry ─────────────────────────────────────────────────────

export function skillRegistryPath(): string {
  return path.join(configDir(), 'skill-installs.json')
}

/** Recorded skill directories; an unreadable / malformed file reads as empty. */
export function readSkillInstalls(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(skillRegistryPath(), 'utf8'))
    if (!Array.isArray(data?.installs)) return []
    return data.installs.filter(
      (p: unknown): p is string => typeof p === 'string'
    )
  } catch {
    return []
  }
}

export function writeSkillInstalls(dirs: string[]): void {
  const unique = [...new Set(dirs.map(d => path.resolve(d)))]
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(
    skillRegistryPath(),
    JSON.stringify({ installs: unique }, null, 2) + '\n'
  )
}

export function recordSkillInstall(skillDir: string): void {
  writeSkillInstalls([...readSkillInstalls(), skillDir])
}

// ── Refresh ──────────────────────────────────────────────────────────────

export type SkillSyncOutcome =
  | 'updated' // rewritten from the bundle
  | 'up-to-date' // already identical
  | 'source' // Lumo source checkout — skipped, kept registered
  | 'missing' // no SKILL.md any more — dropped from the registry
  | 'failed' // could not be read or written — kept registered, retried next time

export interface SkillSyncResult {
  skillDir: string
  outcome: SkillSyncOutcome
  files?: number
  error?: string
}

/**
 * Refresh every registered skill directory (plus `discovered` ones that
 * already hold a skill — installs made before the registry existed) from
 * `srcDir`, then rewrite the registry: discovered installs are added,
 * vanished ones removed.
 */
export function syncSkills(
  srcDir: string,
  discovered: string[] = []
): SkillSyncResult[] {
  const registered = readSkillInstalls().map(d => path.resolve(d))
  const found = discovered.map(d => path.resolve(d)).filter(hasSkill)
  const targets = [...new Set([...registered, ...found])]

  // One unreadable / unwritable location must not stop the others.
  const results = targets.map(skillDir => {
    try {
      return syncOne(srcDir, skillDir)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { skillDir, outcome: 'failed', error } satisfies SkillSyncResult
    }
  })

  writeSkillInstalls(
    results.filter(r => r.outcome !== 'missing').map(r => r.skillDir)
  )
  return results
}

function syncOne(srcDir: string, skillDir: string): SkillSyncResult {
  if (!hasSkill(skillDir)) return { skillDir, outcome: 'missing' }
  if (isLumoSourceCheckout(skillDir)) return { skillDir, outcome: 'source' }
  if (skillMatchesBundle(srcDir, skillDir)) {
    return { skillDir, outcome: 'up-to-date' }
  }
  return { skillDir, outcome: 'updated', files: writeSkill(srcDir, skillDir) }
}
