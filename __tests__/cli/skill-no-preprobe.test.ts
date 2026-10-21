/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as path from 'path'

const SKILL_DIR = path.resolve(__dirname, '../../cli/skill')

function skillDocs(): Array<[string, string]> {
  const files = [
    'SKILL.md',
    ...fs
      .readdirSync(path.join(SKILL_DIR, 'references'))
      .map(f => `references/${f}`),
  ]
  return files
    .filter(f => f.endsWith('.md'))
    .map(f => [f, fs.readFileSync(path.join(SKILL_DIR, f), 'utf8')])
}

describe('lumo skill docs do not instruct a whoami or version pre-probe', () => {
  it('has no probe-before-running instruction in SKILL.md or any reference', () => {
    const offenders = skillDocs().filter(([, text]) =>
      /which lumo && lumo (whoami|--version)|Before running any `lumo` command, verify|Do NOT proceed with any lumo commands until/.test(
        text
      )
    )
    expect(offenders.map(([f]) => f)).toEqual([])
  })

  it('tells the agent to troubleshoot only on failure', () => {
    const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
    const prereq = skill.slice(
      skill.indexOf('## Prerequisites'),
      skill.indexOf('## How this skill is organized')
    )
    expect(prereq).toMatch(/Don't pre-probe/)
    expect(prereq).toContain('command not found: lumo')
    expect(prereq).toContain('lumo auth login')
  })
})
