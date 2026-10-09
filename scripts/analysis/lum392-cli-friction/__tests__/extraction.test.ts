/**
 * LUM-413: extraction fidelity — quoting must survive segment extraction,
 * otherwise free-text positionals (comment bodies, titles) leak fake
 * `--flag` tokens into flag stats and AST validation.
 */
import {
  extractLumoSegments,
  parseInvocation,
} from '../../../cli-grammar/parse'

describe('extractLumoSegments preserves original quoting', () => {
  it('keeps quoted bodies intact', () => {
    expect(
      extractLumoSegments('lumo task comment LUM-1 "use --noEmit before PR"')
    ).toEqual(['lumo task comment LUM-1 "use --noEmit before PR"'])
  })

  it('strips leading env assignments but keeps the rest verbatim', () => {
    expect(
      extractLumoSegments('DOTENV_CONFIG_PATH=.env.x lumo whoami')
    ).toEqual(['lumo whoami'])
    expect(
      extractLumoSegments('FOO="a b" BAR=1 lumo task list --status done')
    ).toEqual(['lumo task list --status done'])
  })

  it('still splits statements and ignores non-invocations', () => {
    expect(extractLumoSegments('cd x && lumo task list && echo done')).toEqual([
      'lumo task list',
    ])
    expect(extractLumoSegments('echo lumo task list')).toEqual([])
    expect(extractLumoSegments('grep lumo SKILL.md')).toEqual([])
  })

  it('does not split on separators inside quotes (multi-line bodies stay whole)', () => {
    const cmd =
      'lumo task create "Title" --description "line one\nline two --source X && more; --status DONE"'
    expect(extractLumoSegments(cmd)).toEqual([cmd])
    const inv = parseInvocation(cmd)
    expect(inv.flags).toEqual(['--description'])
  })

  it('keeps command substitution invocations', () => {
    expect(extractLumoSegments('VAR=$(lumo task show LUM-1)')).toEqual([
      'lumo task show LUM-1)',
    ])
  })
})

describe('parseInvocation flag extraction with quoting preserved', () => {
  it('does not leak flag-shaped words from quoted bodies', () => {
    const inv = parseInvocation(
      'lumo task comment LUM-1 "please run tsc --noEmit and check --status"'
    )
    expect(inv.commandPath).toBe('task comment')
    expect(inv.flags).toEqual([])
  })

  it('still extracts real flags', () => {
    const inv = parseInvocation('lumo task update LUM-2 --status done -p high')
    expect(inv.flags).toEqual(expect.arrayContaining(['--status', '-p']))
  })
})
