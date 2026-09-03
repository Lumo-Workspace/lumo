/**
 * LUM-733: the CLI no longer exposes the AGENT verdict channel
 * (`lumo verdict`), the fidelity read-out (`lumo fidelity`), or the manual
 * outcome-record path (`lumo outcome record`). The kept neighbours —
 * `outcome show`, `outcome rate`, `crossing explain` — stay. The grammar and
 * the skill docs agree with the registered program.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const REMOVED = ['verdict', 'fidelity', 'fidelity show', 'outcome record']
const KEPT = ['outcome show', 'outcome rate', 'crossing explain', 'verify']

describe('LUM-733 CLI surface reduction', () => {
  it('LUM-733 CLI no longer registers verdict, fidelity, or outcome record', () => {
    // 1. The registered program (source of truth).
    const index = read('cli/src/index.ts')
    // `milestone criteria verdict` (human/steward, milestone-level) stays —
    // only the task-level `verdict [task]` AGENT channel is gone.
    expect(index).not.toMatch(/\.command\('verdict \[task\]'\)/)
    expect(index).not.toMatch(/\.command\('fidelity/)
    expect(index).not.toMatch(/\.command\('record <task>'\)/)
    expect(index).not.toMatch(/commands\/(verdict|fidelity)'/)
    expect(index).toMatch(/\.command\('explain <id>'\)/)
    expect(index).toMatch(/\.command\('show <task>'\)/)
    expect(index).toMatch(/\.command\('rate'\)/)
    for (const f of [
      'cli/src/commands/verdict.ts',
      'cli/src/commands/fidelity.ts',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(false)
    }

    // 2. The grammar (what the doc-examples test validates examples against).
    const grammar = JSON.parse(
      read('scripts/analysis/lum392-cli-friction/grammar.json')
    ) as { commands: Record<string, unknown> }
    const names = Object.keys(grammar.commands)
    for (const r of REMOVED) expect(names).not.toContain(r)
    for (const k of KEPT) expect(names).toContain(k)

    // 3. The skill docs the agent reads.
    const docs = [
      '.claude/skills/lumo/SKILL.md',
      ...fs
        .readdirSync(path.join(ROOT, '.claude/skills/lumo/references'))
        .map(f => `.claude/skills/lumo/references/${f}`),
    ]
    expect(docs).not.toContain('.claude/skills/lumo/references/fidelity.md')
    for (const d of docs) {
      const body = read(d)
      // Only the explicit "does not exist" / removal notes may name them.
      const stripped = body
        .split('\n')
        .filter(l => !/removed in LUM-733|No `lumo verdict`/.test(l))
        .join('\n')
      expect(stripped).not.toMatch(/lumo verdict\b/)
      expect(stripped).not.toMatch(/lumo fidelity\b/)
      expect(stripped).not.toMatch(/lumo outcome record\b/)
      expect(stripped).not.toMatch(/verdict --fail/)
    }
  })
})
