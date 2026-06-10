/**
 * LUM-413: grammar snapshot drift guard. Regenerates the grammar from the
 * live CLI source (cli/src/index.ts under LUMO_CLI_INTROSPECT=1) and fails
 * when the committed grammar.json no longer matches — so any CLI command
 * change forces `npx tsx scripts/analysis/lum392-cli-friction/emit-grammar.ts`
 * and a re-run of the AST regression set.
 */
import { execFileSync } from 'child_process'
import { join } from 'path'
import grammarJson from '../grammar.json'
import type { CliGrammar } from '../grammar'
import {
  parseCaseInsensitiveMarker,
  parseEnumFromDescription,
} from '../grammar'
import { KNOWN_COMMAND_PATHS } from '../parse'

const grammar = grammarJson as CliGrammar
const HERE = join(process.cwd(), 'scripts/analysis/lum392-cli-friction')

describe('grammar.json drift', () => {
  it('matches a fresh extraction from cli/src (regenerate with emit-grammar.ts on mismatch)', () => {
    const printed = execFileSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [join(HERE, 'emit-grammar.ts'), '--print'],
      { encoding: 'utf8', timeout: 120_000 }
    )
    // Compare the command tree only: cliVersion is informational metadata —
    // a release that bumps cli/package.json without touching any command
    // must not redden this test (it did once: 1.26.0 → 1.27.0, PR #485).
    const fresh = JSON.parse(printed) as CliGrammar
    expect(fresh.commands).toEqual(grammar.commands)
  }, 150_000)

  it('covers every command path the LUM-392 parser knows', () => {
    const keys = new Set(Object.keys(grammar.commands))
    const missing = KNOWN_COMMAND_PATHS.filter(p => !keys.has(p))
    expect(missing).toEqual([])
  })

  it('extracted enum sets match the CLI help-text contract (spot checks)', () => {
    expect(grammar.commands['task update']!.flags['--status']!.enum).toEqual([
      'todo',
      'in_progress',
      'in_review',
      'done',
    ])
    expect(grammar.commands['task update']!.flags['--priority']!.enum).toEqual([
      'low',
      'medium',
      'high',
      'urgent',
    ])
    expect(
      grammar.commands['task criteria set']!.flags['--cause']!.enum
    ).toEqual([
      'NEW_INFO',
      'SCOPE_CHANGE',
      'DRAFT_BLIND_SPOT',
      'GRANULARITY',
      'OTHER',
    ])
  })

  it('open example lists never become enums: --source/--kind carry none (LUM-420)', () => {
    expect(grammar.commands['task artifact add']!.flags['--source']!.enum).toBe(
      null
    )
    expect(grammar.commands['task artifact add']!.flags['--kind']!.enum).toBe(
      null
    )
    expect(
      grammar.commands['task artifact update']!.flags['--source']!.enum
    ).toBe(null)
    // The parser itself: a pipe list preceded by `e.g.` is an example list,
    // not an enum — even when a quoted token breaks the match mid-list (the
    // exact shape that misflagged 135 `--source Superpowers` calls).
    expect(
      parseEnumFromDescription(
        'Artifact kind, e.g. spec | plan | design (opaque)'
      )
    ).toBe(null)
    expect(
      parseEnumFromDescription(
        'Spec-gen framework, formal name e.g. Superpowers | "Spec Kit" | BMad | OpenSpec | GSD (opaque)'
      )
    ).toBe(null)
    expect(
      parseEnumFromDescription('New status: todo | done (case-insensitive)')
    ).toEqual(['todo', 'done'])
  })

  it('every closed enum carries the case-insensitive help marker (LUM-420)', () => {
    // The CLI runtime normalizes case before validating on every enum flag
    // today (normalizeStatus/normalizeAgent/normalizeScope/toLowerCase…). A
    // future case-SENSITIVE enum flag must either document the marker or be
    // exempted here explicitly — silence would reopen the doc-behavior gap.
    const caseSensitiveExemptions: string[] = []
    for (const [path, cmd] of Object.entries(grammar.commands)) {
      for (const [long, flag] of Object.entries(cmd.flags)) {
        if (!flag.enum) continue
        const key = `${path} ${long}`
        if (caseSensitiveExemptions.includes(key)) continue
        expect({ key, enumCaseInsensitive: flag.enumCaseInsensitive }).toEqual({
          key,
          enumCaseInsensitive: true,
        })
        expect(parseCaseInsensitiveMarker(flag.description)).toBe(true)
      }
    }
  })

  it('keeps structural invariants the validator relies on', () => {
    // Group nodes route to subcommands; leaves carry the flags.
    expect(grammar.commands['task']!.hasSubcommands).toBe(true)
    expect(grammar.commands['task update']!.hasSubcommands).toBe(false)
    // Short aliases are resolvable.
    expect(grammar.commands['task update']!.flags['--status']!.short).toBe('-s')
    // Every enum is small, deduped, and identifier-shaped.
    for (const [path, cmd] of Object.entries(grammar.commands)) {
      for (const [long, flag] of Object.entries(cmd.flags)) {
        expect(long.startsWith('--')).toBe(true)
        if (flag.enum) {
          expect(flag.enum.length).toBeGreaterThanOrEqual(2)
          expect(flag.enum.length).toBeLessThanOrEqual(10)
          expect(new Set(flag.enum).size).toBe(flag.enum.length)
          for (const v of flag.enum) {
            expect(v).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
          }
          // The enum must be re-derivable from the description (single
          // source: the help text agents actually see).
          expect(parseEnumFromDescription(flag.description)).toEqual(flag.enum)
        }
        void path
      }
    }
  })
})
