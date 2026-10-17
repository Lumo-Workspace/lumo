/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch E — one error shape (`Error:` / `Usage:` / `Hint:` on
 * stderr), a JSON error object under `--json`, exit 2 for usage errors, and
 * git's `fatal:` wrapped (docs/cli-output-conventions.md X-1–X-4, J-4).
 */
import {
  buildErrorJson,
  classifyError,
  finalizeErrorOutput,
  installErrorOutput,
  normalizeErrorLine,
  notFoundHint,
  resetErrorOutputForTests,
} from '../../cli/src/lib/error-output'
import { describeThrownError } from '../../cli/src/lib/errors'
import {
  EXIT_BLOCKED,
  EXIT_CONFIRMATION_REQUIRED,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
} from '../../cli/src/lib/exit-codes'

describe('X-4 — exit codes', () => {
  it('0 ok, 1 error, 2 usage; 4 and 5 unchanged', () => {
    expect([EXIT_OK, EXIT_ERROR, EXIT_USAGE]).toEqual([0, 1, 2])
    expect(EXIT_CONFIRMATION_REQUIRED).toBe(4)
    expect(EXIT_BLOCKED).toBe(5)
  })
})

describe('X-1 — normalizeErrorLine', () => {
  it("rewrites Commander's lower-case prefix", () => {
    expect(normalizeErrorLine("error: unknown option '--json'")).toEqual([
      "Error: unknown option '--json'",
    ])
  })

  it('drops the old Commander --help aside (a Hint replaces it)', () => {
    expect(
      normalizeErrorLine(
        '(run the command with --help to list its valid flags and arguments)'
      )
    ).toEqual([])
  })

  it('moves a usage string onto its own Usage: line', () => {
    expect(
      normalizeErrorLine('Error: usage: lumo task deps list <LUM-42>')
    ).toEqual([
      'Error: missing or invalid arguments',
      'Usage: lumo task deps list <LUM-42>',
    ])
    expect(
      normalizeErrorLine(
        'Error: missing <doc>. Usage: lumo doc delete <doc> --confirm'
      )
    ).toEqual([
      'Error: missing <doc>',
      'Usage: lumo doc delete <doc> --confirm',
    ])
  })

  it('moves inline remediation to a Hint: line (X-2)', () => {
    expect(
      normalizeErrorLine(
        'Error: no milestone matches "nope" in this project. Try `lumo milestone list`.'
      )
    ).toEqual([
      'Error: no milestone matches "nope" in this project',
      'Hint: run `lumo milestone list`.',
    ])
    expect(
      normalizeErrorLine(
        'Error: sprint #999 not found in this workspace. If your workspace has multiple sprints-enabled teams, pass --team <name> or use the sprint UUID.'
      )
    ).toEqual([
      'Error: sprint #999 not found in this workspace',
      'Hint: If your workspace has multiple sprints-enabled teams, pass --team <name> or use the sprint UUID.',
    ])
  })

  it('never touches the protected auth strings (§14)', () => {
    for (const l of [
      'Error: API key invalid or revoked. Run `lumo auth login`.',
      'Error: not logged in. Run `lumo auth login` first.',
    ])
      expect(normalizeErrorLine(l)).toEqual([l])
  })
})

describe('X-2 — not-found hints', () => {
  it('names the listing command for the resource', () => {
    expect(
      notFoundHint('Error: task LUM-999999 not found in workspace lumo')
    ).toBe(
      'list tasks with `lumo task list`, or search with `lumo task search <text>`.'
    )
    expect(
      notFoundHint('Error: PR #999999 not found in workspace lumo')
    ).toMatch(/lumo task show/)
    expect(notFoundHint('Error: invalid --limit "x"')).toBeNull()
  })
})

describe('J-4 — classifyError / buildErrorJson', () => {
  it('maps exit code and message to a code', () => {
    expect(classifyError(2, 'unknown option')).toBe('USAGE')
    expect(classifyError(1, 'task LUM-9 not found in workspace lumo')).toBe(
      'NOT_FOUND'
    )
    expect(
      classifyError(1, 'API key invalid or revoked. Run `lumo auth login`.')
    ).toBe('AUTH')
    expect(classifyError(1, 'list failed (HTTP 503)')).toBe('SERVER')
    expect(classifyError(1, 'something odd')).toBe('UNKNOWN')
  })

  it('one object: message, hint, details, exit code', () => {
    expect(
      buildErrorJson(
        [
          'Error: task LUM-9 not found in workspace lumo',
          'Hint: list tasks with `lumo task list`.',
          '⚠ a warning',
        ],
        1
      )
    ).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'task LUM-9 not found in workspace lumo',
        hint: 'list tasks with `lumo task list`.',
        details: ['⚠ a warning'],
        exitCode: 1,
      },
    })
  })
})

describe('the stderr filter end to end (custom sink)', () => {
  let out: string[] = []
  afterEach(() => resetErrorOutputForTests())

  it('text mode: normalises lines and adds the missing not-found Hint at exit', () => {
    out = []
    installErrorOutput({ json: false, write: s => out.push(s) })
    process.stderr.write('Error: task LUM-999999 not found in workspace lumo\n')
    finalizeErrorOutput(1)
    expect(out.join('')).toBe(
      'Error: task LUM-999999 not found in workspace lumo\n' +
        'Hint: list tasks with `lumo task list`, or search with `lumo task search <text>`.\n'
    )
  })

  it('text mode: a usage error gets Usage and a --help Hint', () => {
    out = []
    installErrorOutput({ json: false, write: s => out.push(s) })
    process.stderr.write("error: missing required argument 'number'\n")
    finalizeErrorOutput(2, {
      usage: 'lumo pr scan [options] <number>',
      helpCommand: 'lumo pr scan',
    })
    expect(out.join('')).toBe(
      "Error: missing required argument 'number'\n" +
        'Usage: lumo pr scan [options] <number>\n' +
        'Hint: see `lumo pr scan --help` for every flag and argument.\n'
    )
  })

  it('--json: a failure is exactly one JSON object; nothing else on stderr', () => {
    out = []
    installErrorOutput({ json: true, write: s => out.push(s) })
    process.stderr.write('Error: task LUM-999999 not found in workspace lumo\n')
    expect(out).toEqual([])
    finalizeErrorOutput(1)
    expect(out).toHaveLength(1)
    const parsed = JSON.parse(out[0]!) as { error: Record<string, unknown> }
    expect(parsed.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'task LUM-999999 not found in workspace lumo',
      exitCode: 1,
    })
    expect(String(parsed.error.hint)).toMatch(/lumo task list/)
  })

  it('--json: a success passes its stderr through unchanged', () => {
    out = []
    installErrorOutput({ json: true, write: s => out.push(s) })
    process.stderr.write('⚠ something worth knowing\n')
    finalizeErrorOutput(0)
    expect(out.join('')).toBe('⚠ something worth knowing\n')
  })

  it('exit 4 / 5 are not errors: held lines flush as-is', () => {
    out = []
    installErrorOutput({ json: true, write: s => out.push(s) })
    process.stderr.write('note on stderr\n')
    finalizeErrorOutput(4)
    expect(out.join('')).toBe('note on stderr\n')
  })
})

describe('X-3 — describeThrownError', () => {
  it("wraps git's fatal instead of passing it through", () => {
    expect(
      describeThrownError(
        new Error(
          'fatal: not a git repository (or any of the parent directories): .git'
        )
      )
    ).toEqual([
      'Error: this command must run inside a git checkout (git: not a git repository)',
      'Hint: cd into your project directory and run it again.',
    ])
    expect(describeThrownError(new Error('fatal: bad revision'))).toEqual([
      'Error: git failed: bad revision',
    ])
    expect(describeThrownError(new Error('boom'))).toEqual(['Error: boom'])
  })
})
