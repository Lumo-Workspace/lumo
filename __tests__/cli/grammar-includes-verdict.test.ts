/** @jest-environment node */
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * LUM-422 / LUM-409 trap: the CLI grammar snapshot must be regenerated after a
 * command change (`npx tsx scripts/analysis/lum392-cli-friction/emit-grammar.ts`).
 * This pins that the `verdict` command and its flags made it into the snapshot —
 * a stale grammar.json (forgotten regen) fails here.
 */
describe('grammar.json includes the verdict command', () => {
  const grammar = JSON.parse(
    readFileSync(
      join(process.cwd(), 'scripts/analysis/lum392-cli-friction/grammar.json'),
      'utf8'
    )
  ) as { commands: Record<string, { flags?: Record<string, unknown> }> }

  it('registers a verdict command node', () => {
    expect(grammar.commands.verdict).toBeDefined()
  })

  it('carries the two verdict modes plus --reason and --criterion', () => {
    const flags = grammar.commands.verdict?.flags ?? {}
    expect(flags['--pass']).toBeDefined()
    expect(flags['--fail']).toBeDefined()
    expect(flags['--reason']).toBeDefined()
    expect(flags['--criterion']).toBeDefined()
  })
})
