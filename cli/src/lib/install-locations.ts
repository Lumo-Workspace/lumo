import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface InstallLocation {
  /** Absolute path of the skill dir (…/skills/lumo). */
  path: string
  scope: 'user' | 'project'
  /** Agent token implied by the location (.claude → claude-code, .agents → codex). */
  agent: string
}

export interface LocationOptions {
  homeDir?: string
  cwd?: string
}

/** Root of the git work tree containing `cwd`, or null outside a repo. */
export function repoRoot(cwd: string): string | null {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  })
  if (res.error || res.status !== 0) return null
  const out = res.stdout.trim()
  return out ? out : null
}

/**
 * Every place a Lumo skill may live, whether or not it exists: user
 * ~/.claude and ~/.agents, plus the same two under the repo root of `cwd`.
 */
export function knownSkillLocations(
  opts: LocationOptions = {}
): InstallLocation[] {
  const home = opts.homeDir ?? os.homedir()
  const locs: InstallLocation[] = [
    {
      path: path.join(home, '.claude', 'skills', 'lumo'),
      scope: 'user',
      agent: 'claude-code',
    },
    {
      path: path.join(home, '.agents', 'skills', 'lumo'),
      scope: 'user',
      agent: 'codex',
    },
  ]
  const root = repoRoot(opts.cwd ?? process.cwd())
  if (root) {
    locs.push(
      {
        path: path.join(root, '.claude', 'skills', 'lumo'),
        scope: 'project',
        agent: 'claude-code',
      },
      {
        path: path.join(root, '.agents', 'skills', 'lumo'),
        scope: 'project',
        agent: 'codex',
      }
    )
  }
  return locs
}

/** The known locations that currently contain a skill dir. */
export function detectInstalledSkills(
  opts: LocationOptions = {}
): InstallLocation[] {
  return knownSkillLocations(opts).filter(l => fs.existsSync(l.path))
}
