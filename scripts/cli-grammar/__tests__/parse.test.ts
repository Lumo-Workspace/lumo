import {
  KNOWN_COMMAND_PATHS,
  classifyOutput,
  extractLumoSegments,
  firstPositionalArg,
  parseInvocation,
  tokenize,
} from '../parse'

describe('tokenize', () => {
  it('splits on whitespace and honors quotes', () => {
    expect(tokenize(`lumo task create "Fix the bug" --priority high`)).toEqual([
      'lumo',
      'task',
      'create',
      'Fix the bug',
      '--priority',
      'high',
    ])
  })

  it('handles single quotes', () => {
    expect(tokenize(`lumo task comment LUM-1 'hello world'`)).toEqual([
      'lumo',
      'task',
      'comment',
      'LUM-1',
      'hello world',
    ])
  })
})

describe('extractLumoSegments', () => {
  it('finds lumo at command position in compound commands', () => {
    const segs = extractLumoSegments('cd /tmp && lumo task list --status todo')
    expect(segs).toEqual(['lumo task list --status todo'])
  })

  it('finds multiple invocations in one Bash call', () => {
    const segs = extractLumoSegments(
      'lumo session attach LUM-1 && lumo task show LUM-1 --full'
    )
    expect(segs).toHaveLength(2)
  })

  it('ignores lumo inside paths and words', () => {
    expect(
      extractLumoSegments('grep -rn foo /Users/x/Desktop/lumo/lumo')
    ).toEqual([])
    expect(extractLumoSegments('cat lumo_pmem.txt')).toEqual([])
  })

  it('ignores backtick-quoted doc references and line continuations', () => {
    expect(
      extractLumoSegments('echo "run `lumo task list` to see tasks"')
    ).toEqual([])
    expect(extractLumoSegments('lumo task list \\')).toEqual([])
    expect(
      extractLumoSegments(
        `sed -n '/lumo milestone show/' .claude/skills/lumo/SKILL.md`
      )
    ).toEqual([])
  })

  it('strips leading env assignments', () => {
    expect(extractLumoSegments('LUMO_DEBUG=1 lumo whoami')).toEqual([
      'LUMO_DEBUG=1 lumo whoami'.replace('LUMO_DEBUG=1 ', ''),
    ])
  })
})

describe('parseInvocation', () => {
  it('resolves longest command path first', () => {
    expect(parseInvocation('lumo task artifact list LUM-5').commandPath).toBe(
      'task artifact list'
    )
    expect(parseInvocation('lumo task comment add "done"').commandPath).toBe(
      'task comment add'
    )
    expect(
      parseInvocation('lumo task dep add LUM-5 --blocked-by LUM-4').commandPath
    ).toBe('task dep add')
  })

  it('marks unmapped paths as unknown and keeps the head tokens', () => {
    const inv = parseInvocation('lumo session start LUM-43')
    expect(inv.known).toBe(false)
    expect(inv.commandPath).toBe('unknown:session start LUM-43')
  })

  it('collects flags with values stripped', () => {
    const inv = parseInvocation('lumo task update LUM-9 --status=done -p high')
    expect(inv.flags).toEqual(expect.arrayContaining(['--status', '-p']))
  })

  it('stops path matching at the first flag', () => {
    expect(parseInvocation('lumo task list --status todo').commandPath).toBe(
      'task list'
    )
  })

  it('knows every shipped command path resolves to itself', () => {
    for (const path of KNOWN_COMMAND_PATHS) {
      expect(parseInvocation(`lumo ${path} ARG`).commandPath).toBe(path)
    }
  })
})

describe('firstPositionalArg', () => {
  it('returns the identifier after the command path', () => {
    expect(
      firstPositionalArg(
        parseInvocation('lumo task update LUM-9 --status done')
      )
    ).toBe('LUM-9')
  })

  it('returns null when only flags follow', () => {
    expect(
      firstPositionalArg(parseInvocation('lumo task list --status todo'))
    ).toBeNull()
  })
})

describe('classifyOutput', () => {
  const base = { stdout: '', stderr: '', interrupted: false }

  it('detects CLI error lines', () => {
    const r = classifyOutput({
      ...base,
      stdout: 'Error: task LUM-9 not found in workspace lumo',
    })
    expect(r.errorKind).toBe('cli-error')
    expect(r.evidence).toContain('not found')
  })

  it('detects commander usage errors', () => {
    const r = classifyOutput({
      ...base,
      stderr: "error: unknown option '--body'",
    })
    expect(r.errorKind).toBe('usage-error')
  })

  it('detects interruption', () => {
    expect(classifyOutput({ ...base, interrupted: true }).errorKind).toBe(
      'interrupted'
    )
  })

  it('treats normal output as success', () => {
    const r = classifyOutput({ ...base, stdout: 'Updated LUM-48 "Title"' })
    expect(r.errored).toBe(false)
  })
})
