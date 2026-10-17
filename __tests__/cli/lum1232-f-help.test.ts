/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch F — help text (docs/cli-output-conventions.md HT-1–HT-3):
 * Examples and Exit codes sections, descriptions of at most 200 characters,
 * no internal ticket numbers, no mention of the removed dashboard.
 */
import grammarJson from '../../scripts/cli-grammar/grammar.json'
import type { CliGrammar } from '../../scripts/cli-grammar/grammar'
import {
  attachHelpSections,
  examplesHelp,
  exitCodesHelp,
  rootExitCodesHelp,
} from '../../cli/src/lib/help-text'

const grammar = grammarJson as unknown as CliGrammar
/** Provenance like `(LUM-1187)` / `LUM-344:`; sample input like `LUM-42` is fine. */
const TICKET_RE = /\((?:LUM|SPEC)-\d+\)|\b(?:LUM|SPEC)-\d+:|\bLUM-\d{3,}\b/

describe('HT-1 — Examples and Exit codes sections', () => {
  it('Examples: one indented invocation per line', () => {
    expect(examplesHelp('task list')).toBe(
      '\nExamples:\n  lumo task list\n  lumo task list --status in_progress --limit 10\n  lumo task list --cursor 50'
    )
    expect(examplesHelp('no such command')).toBe('')
  })

  it('Exit codes: 0 / 1 / 2 plus the 4 / 5 the command can return', () => {
    const out = exitCodesHelp('task update').split('\n')
    expect(out[1]).toBe('Exit codes:')
    expect(out.slice(2).map(l => l.trim().split(' ')[0])).toEqual([
      '0',
      '1',
      '2',
      '4',
      '5',
    ])
    expect(exitCodesHelp('sprint delete')).toContain(
      '  4  the user must confirm'
    )
    expect(exitCodesHelp('sprint delete')).not.toContain('  5  ')
    expect(exitCodesHelp('task list')).toBe('')
    expect(rootExitCodesHelp()).toContain('  2  usage error')
  })

  it('attachHelpSections hangs the sections on matching commands only', () => {
    const added: Record<string, string> = {}
    const mk = (name: string, parent: unknown, commands: unknown[] = []) => {
      const node = {
        name: () => name,
        parent,
        commands,
        addHelpText: (_: 'after', text: string) => {
          added[name] = (added[name] ?? '') + text
        },
      }
      return node
    }
    const root = mk('lumo', null) as ReturnType<typeof mk> & {
      commands: unknown[]
    }
    const task = mk('task', root)
    const list = mk('list', task)
    const update = mk('update', task)
    ;(task.commands as unknown[]).push(list, update)
    ;(root.commands as unknown[]).push(task)
    const touched = attachHelpSections(root as never)
    expect(touched.sort()).toEqual(['task list', 'task update'])
    expect(added.lumo).toContain('Exit codes:')
    expect(added.list).toContain('Examples:')
    expect(added.update).toContain('Exit codes:')
    expect(added.task).toBeUndefined()
  })
})

describe('HT-2 / HT-3 — descriptions in the shipped grammar', () => {
  const commands = Object.entries(grammar.commands)

  it('every command description is at most 200 characters', () => {
    const long = commands
      .filter(([, c]) => (c.description ?? '').length > 200)
      .map(([p, c]) => `${p} (${(c.description ?? '').length})`)
    expect(long).toEqual([])
  })

  it('no command or flag description carries an internal ticket number', () => {
    const hits: string[] = []
    for (const [p, c] of commands) {
      if (TICKET_RE.test(c.description ?? '')) hits.push(p)
      for (const [f, fl] of Object.entries(c.flags))
        if (TICKET_RE.test(fl.description ?? '')) hits.push(`${p} ${f}`)
    }
    expect(hits).toEqual([])
  })

  it('task status no longer mentions the removed dashboard', () => {
    const c = grammar.commands['task status']!
    expect(c.description).not.toMatch(/dashboard/i)
    for (const fl of Object.values(c.flags))
      expect(fl.description ?? '').not.toMatch(/dashboard/i)
  })
})

describe('HT-1 — the real program prints the sections in --help', () => {
  it('task update shows Examples and Exit codes; lumo --help ends with the table', () => {
    process.env.LUMO_CLI_INTROSPECT = '1'
    let program: {
      commands: Array<{ name(): string; commands: unknown[] }>
      configureOutput(o: { writeOut: (s: string) => void }): unknown
      outputHelp(): void
    }
    jest.isolateModules(() => {
      program = (require('../../cli/src/index') as { program: never }).program
    })
    const helpOf = (cmd: { configureOutput: unknown; outputHelp(): void }) => {
      let out = ''
      ;(cmd.configureOutput as (o: { writeOut: (s: string) => void }) => void)({
        writeOut: s => {
          out += s
        },
      })
      cmd.outputHelp()
      return out
    }
    const task = program!.commands.find(c => c.name() === 'task') as never as {
      commands: Array<{
        name(): string
        configureOutput: unknown
        outputHelp(): void
      }>
    }
    const update = task.commands.find(c => c.name() === 'update')!
    const text = helpOf(update)
    expect(text).toContain(
      'Examples:\n  lumo task update LUM-42 --status in_progress'
    )
    expect(text).toContain('--add-tag security\n\nExit codes:\n  0  ok')
    expect(text).toContain('  5  blocked by a human-only gate')
    expect(helpOf(program! as never)).toContain(
      'Exit codes:\n  0  ok\n  1  failed\n  2  usage error'
    )
  })
})
