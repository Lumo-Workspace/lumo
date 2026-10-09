import { execFileSync } from 'child_process'
import * as fs from 'fs'
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

function isGitTracked(dir: string): boolean {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
    return out.trim().length > 0
  } catch {
    return false
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
