/**
 * LUM-405: context drift detector (v1, rule ① only).
 *
 * Mechanizes the CLAUDE.md human rule "改 cli/src/commands/ 必同步 SKILL.md":
 * if a changeset touches cli/src/commands/** but not the lumo skill docs, warn.
 * Warning-only (never blocks); commit-message skip marker honors the CLAUDE.md
 * exemptions (pure internal refactor / copy tweak / non-interface bug fix).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { detectDrift, run, SKIP_MARKER } from '../drift-check'

const CLI_CHANGE = 'cli/src/commands/task.ts'
const SKILL = 'cli/skill/SKILL.md'
const REFERENCE = 'cli/skill/references/tasks.md'

describe('drift-check', () => {
  it('drift-detector flags cli command change with no companion doc', () => {
    const warnings = detectDrift([CLI_CHANGE], 'feat: add --foo flag [LUM-1]')

    expect(warnings).toHaveLength(1)
    // The warning must name the unmet companion so the committer knows what to sync.
    expect(warnings[0]!.message).toContain('SKILL.md')
  })

  it('drift-detector stays silent when companion co-changed or rule is unmatched', () => {
    // SKILL.md co-changed
    expect(detectDrift([CLI_CHANGE, SKILL], 'feat: x [LUM-1]')).toEqual([])
    // a references/** file co-changed
    expect(detectDrift([CLI_CHANGE, REFERENCE], 'feat: x [LUM-1]')).toEqual([])
    // nothing under a trigger path
    expect(
      detectDrift(['lib/services/task.service.ts', 'README.md'], 'chore: x')
    ).toEqual([])
  })

  it('drift-detector exits zero even when drift is detected', () => {
    const writes: string[] = []
    const code = run({
      changedFiles: [CLI_CHANGE],
      commitMessage: 'feat: add flag [LUM-1]',
      write: s => writes.push(s),
    })

    expect(code).toBe(0) // warning-only, never blocks the commit
    expect(writes.join('')).toContain('SKILL.md') // …but it did warn
  })

  it('drift-detector skip marker in commit message suppresses the warning', () => {
    const msg = `refactor: rename internal helper, no interface change ${SKIP_MARKER}`
    expect(detectDrift([CLI_CHANGE], msg)).toEqual([])
  })

  it('drift-detector is wired into the husky commit-msg hook', () => {
    const hook = readFileSync(join(process.cwd(), '.husky/commit-msg'), 'utf8')
    // The hook runs the committed script and passes the commit-message file ($1),
    // so the check sees both the staged changeset and the message.
    expect(hook).toContain('scripts/drift-check.ts')
    expect(hook).toContain('$1')
  })
})
