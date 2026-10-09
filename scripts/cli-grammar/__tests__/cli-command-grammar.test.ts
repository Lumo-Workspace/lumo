/**
 * Grammar-snapshot assertions for individual CLI commands. They used to sit in
 * the CLI behaviour suites (__tests__/cli/*, __tests__/lum733-*), which made
 * those public tests import this private tree; LUM-1034 moved them next to
 * grammar.json so the behaviour suites can ship in the open-source snapshot.
 */
import grammarJson from '../grammar.json'

type Cmds = Record<
  string,
  { flags: Record<string, unknown>; args?: unknown } | undefined
>
const cmds = (grammarJson as unknown as { commands: Cmds }).commands
const flagsOf = (path: string) => Object.keys(cmds[path]?.flags ?? {})

describe('CLI command grammar', () => {
  it('grammar lists the batch forms (disposition <ids...>, explain --file)', () => {
    expect(flagsOf('crossing explain')).toContain('--file')
    expect(flagsOf('crossing explain')).toContain('--task')
    expect(JSON.stringify(cmds['crossing disposition'])).toMatch(/ids/)
  })

  it('the command tree lists crossing disposition with its flags (grammar in sync)', () => {
    expect(cmds['crossing disposition']).toBeDefined()
    for (const f of [
      '--false-positive',
      '--confirmed',
      '--note',
      '--task',
      '--receipt',
      '--confirm-read',
      '--confirm',
    ]) {
      expect(flagsOf('crossing disposition')).toContain(f)
    }
  })

  it('task update grammar has --confirm and no --yes/--force alias', () => {
    const flags = flagsOf('task update')
    expect(flags).toContain('--confirm')
    expect(flags).not.toContain('--yes')
    expect(flags).not.toContain('--force')
  })

  it('LUM-733/942: removed commands are gone from the grammar, neighbours kept', () => {
    const REMOVED = [
      'verdict',
      'fidelity',
      'fidelity show',
      'outcome record',
      // LUM-942
      'verify',
      'task criteria',
      'task criteria set',
      'task criteria list',
      'task criteria confirm',
      'criteria',
      'criteria audit',
      'outcome rate',
    ]
    const KEPT = [
      'outcome show',
      'crossing explain',
      'task status',
      'task wrapup',
      'milestone criteria set',
      'milestone criteria list',
      'milestone criteria verdict',
    ]
    const names = Object.keys(cmds)
    for (const r of REMOVED) expect(names).not.toContain(r)
    for (const k of KEPT) expect(names).toContain(k)
  })
})
