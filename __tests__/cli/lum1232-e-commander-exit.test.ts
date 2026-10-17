/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch E — Commander parse errors through the real program: one
 * `Error:` prefix, a `Usage:` line, a `--help` Hint, exit 2; with `--json`,
 * one JSON object on stderr.
 */
process.env.LUMO_CLI_INTROSPECT = '1'

type ErrorOutput = typeof import('../../cli/src/lib/error-output')

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

async function run(argv: string[], json: boolean) {
  const out: string[] = []
  let errorOutput: ErrorOutput | undefined
  let program: { parseAsync(a: string[]): Promise<unknown> } | undefined
  // One module registry for both, so the program finalises the same filter.
  jest.isolateModules(() => {
    errorOutput = require('../../cli/src/lib/error-output') as ErrorOutput
    program = (require('../../cli/src/index') as { program: never }).program
  })
  errorOutput!.installErrorOutput({ json, write: s => out.push(s) })
  const exit = jest.spyOn(process, 'exit').mockImplementation(((
    code?: number
  ) => {
    throw new Exit(code ?? 0)
  }) as never)
  let code = -1
  try {
    await program!.parseAsync(['node', 'lumo', ...argv])
  } catch (e) {
    if (!(e instanceof Exit)) throw e
    code = e.code
  } finally {
    exit.mockRestore()
    errorOutput!.resetErrorOutputForTests()
  }
  return { code, stderr: out.join('') }
}

jest.setTimeout(60_000)

describe('Commander errors (LUM-1232 E1/E2)', () => {
  it('a missing argument exits 2 with Error / Usage / Hint', async () => {
    const r = await run(['pr', 'scan'], false)
    expect(r.code).toBe(2)
    expect(r.stderr).toBe(
      "Error: missing required argument 'number'\n" +
        'Usage: lumo pr scan [options] <number>\n' +
        'Hint: see `lumo pr scan --help` for every flag and argument.\n'
    )
  })

  it('an unknown option exits 2 and never prints the lower-case prefix', async () => {
    const r = await run(['task', 'show', 'LUM-1', '--bogus'], false)
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/^Error: unknown option '--bogus'/)
    expect(r.stderr).not.toMatch(/^error: /m)
    expect(r.stderr).toContain('Usage: lumo task show')
  })

  it('--json: the same failure is one JSON object with code USAGE', async () => {
    const r = await run(['task', 'show', 'LUM-1', '--json'], true)
    expect(r.code).toBe(2)
    const lines = r.stderr.trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!) as { error: Record<string, unknown> }
    expect(parsed.error).toMatchObject({
      code: 'USAGE',
      message: "unknown option '--json'",
      exitCode: 2,
    })
    expect(String(parsed.error.hint)).toContain('lumo task show --help')
  })
})
