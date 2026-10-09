import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { isNewer } from './update-check'
import { readMarker } from './install-registry'
import { hashSkillDir } from './skill-hash'
import skillVersionHashes from './skill-version-hashes.json'

export type SkillState = 'missing' | 'managed' | 'modified'

export interface SkillClassification {
  state: SkillState
  /** Version of the managed copy (from marker or historical table). */
  version?: string
  /** True when any file in the dir is tracked by git in its enclosing repo. */
  gitTracked: boolean
}

export type HashTable = Record<string, string>

export function isNewerVersion(current: string, candidate: string): boolean {
  return isNewer(current, candidate)
}

/**
 * Fails closed: only "git is not installed" or "not inside a git work tree"
 * mean untracked. Any other git failure is treated as tracked so callers never
 * auto-write a path whose tracked-ness could not be established.
 */
function isGitTracked(dir: string): boolean {
  return lsFilesTracked(dir, [])
}

/** Same fail-closed check for a single file or directory path. */
export function isPathGitTracked(p: string): boolean {
  if (fs.statSync(p).isDirectory()) return lsFilesTracked(p, [])
  return lsFilesTracked(path.dirname(p), ['--', path.basename(p)])
}

function lsFilesTracked(cwd: string, extra: string[]): boolean {
  try {
    const out = execFileSync('git', ['ls-files', ...extra], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    return out.trim().length > 0
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string | Buffer }
    if (e.code === 'ENOENT') return false
    if (/not a git repository/i.test(String(e.stderr ?? ''))) return false
    return true
  }
}

/**
 * Classify an installed skill dir: `missing`; `managed` (marker hash matches
 * content, or no marker and content hash is a known released version);
 * otherwise `modified`.
 */
export function classifySkillDir(
  dir: string,
  hashTable: HashTable = skillVersionHashes as HashTable
): SkillClassification {
  if (!fs.existsSync(dir)) return { state: 'missing', gitTracked: false }
  const gitTracked = isGitTracked(dir)
  const current = hashSkillDir(dir)
  const marker = readMarker(dir)
  if (marker) {
    return marker.hash === current
      ? { state: 'managed', version: marker.version, gitTracked }
      : { state: 'modified', gitTracked }
  }
  const legacy = hashTable[current]
  return legacy
    ? { state: 'managed', version: legacy, gitTracked }
    : { state: 'modified', gitTracked }
}
