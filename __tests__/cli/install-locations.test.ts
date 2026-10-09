/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  detectInstalledSkills,
  knownSkillLocations,
} from '@/cli/src/lib/install-locations'

let home: string
let repo: string
let plain: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'loc-home-'))
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'loc-repo-')))
  plain = mkdtempSync(join(tmpdir(), 'loc-plain-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
})
afterEach(() => {
  for (const d of [home, repo, plain])
    rmSync(d, { recursive: true, force: true })
})

describe('install locations', () => {
  it('lists user and repo-root locations for both agents', () => {
    mkdirSync(join(repo, 'sub'))
    const locs = knownSkillLocations({ homeDir: home, cwd: join(repo, 'sub') })
    expect(locs.map(l => l.path)).toEqual([
      join(home, '.claude', 'skills', 'lumo'),
      join(home, '.agents', 'skills', 'lumo'),
      join(repo, '.claude', 'skills', 'lumo'),
      join(repo, '.agents', 'skills', 'lumo'),
    ])
    expect(locs.map(l => `${l.scope}:${l.agent}`)).toEqual([
      'user:claude-code',
      'user:codex',
      'project:claude-code',
      'project:codex',
    ])
  })

  it('omits project locations outside a git repo', () => {
    const locs = knownSkillLocations({ homeDir: home, cwd: plain })
    expect(locs).toHaveLength(2)
  })

  it('detects only the dirs that exist', () => {
    mkdirSync(join(repo, '.agents', 'skills', 'lumo'), { recursive: true })
    const found = detectInstalledSkills({ homeDir: home, cwd: repo })
    expect(found.map(l => l.path)).toEqual([
      join(repo, '.agents', 'skills', 'lumo'),
    ])
  })
})
