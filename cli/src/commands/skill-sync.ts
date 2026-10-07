import * as os from 'os'
import {
  bundledSkillDir,
  hasSkill,
  skillDirFor,
  syncSkills,
  type SkillSyncResult,
} from '../lib/skill-install'

export interface SkillSyncDeps {
  srcDir?: string
  homeDir?: string
  cwd?: string
}

/**
 * LUM-1042: `lumo skill sync` — refresh every installed copy of the lumo skill
 * from the one bundled in this CLI. Targets are the locations `setup` recorded
 * plus the user-scope and current-project installs if they exist (installs
 * made before the registry existed). `lumo update` runs this after upgrading.
 */
export async function skillSync(deps: SkillSyncDeps = {}): Promise<number> {
  const srcDir = deps.srcDir ?? bundledSkillDir()
  if (!hasSkill(srcDir)) {
    process.stderr.write(
      `Error: bundled skill asset missing at ${srcDir} — reinstall @lumoai/cli.\n`
    )
    return 1
  }

  const results = syncSkills(srcDir, [
    skillDirFor(deps.homeDir ?? os.homedir()),
    skillDirFor(deps.cwd ?? process.cwd()),
  ])

  if (results.length === 0) {
    process.stdout.write(
      'No installed lumo skill found. Run `lumo setup` to install one.\n'
    )
    return 0
  }
  for (const r of results) process.stdout.write(formatResult(r) + '\n')
  return 0
}

export function formatResult(r: SkillSyncResult): string {
  switch (r.outcome) {
    case 'updated':
      return `✓ updated skill (${r.files} files): ${r.skillDir}`
    case 'up-to-date':
      return `✓ skill already up to date: ${r.skillDir}`
    case 'source':
      return `- skipped Lumo source checkout (skill source, not an install): ${r.skillDir}`
    case 'missing':
      return `- no longer installed, forgotten: ${r.skillDir}`
  }
}
