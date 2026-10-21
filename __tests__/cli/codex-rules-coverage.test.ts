/**
 * @jest-environment node
 *
 * LUM-1292 Task 5: the Codex rules allow every `lumo` command and prompt the
 * risky ones. That is fail-open for a command missing from the prompt list, so
 * this test is the safety net: it evaluates the generated rules file like
 * Codex does (strictest matching rule wins) for every classified command.
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CODEX_PROMPTED_COMMANDS,
  LUMO_CODEX_RULES,
  buildCodexRules,
  isCodexServerOnly,
} from '@/cli/src/lib/codex-rules'
import {
  codexFlagOrderError,
  isServerOnlyPath,
} from '@/cli/src/lib/codex-flag-order'
import { CODEX_CLASSES } from '@/cli/src/lib/codex-classes.generated'

type Decision = 'allow' | 'prompt' | 'forbidden'
interface Rule {
  pattern: (string | string[])[]
  decision: Decision
}

const STRICTNESS: Record<Decision, number> = {
  allow: 0,
  prompt: 1,
  forbidden: 2,
}

/** Minimal Starlark subset: the `prefix_rule(pattern = [...], decision = "...")` calls we emit. */
function parseRules(text: string): Rule[] {
  const rules: Rule[] = []
  const blocks = text.split(/^prefix_rule\(/m).slice(1)
  for (const block of blocks) {
    const patternSrc = /pattern = (\[.*\]),\n/.exec(block)?.[1]
    const decision = /decision = "(\w+)"/.exec(block)?.[1]
    if (!patternSrc || !decision) throw new Error(`unparsable rule: ${block}`)
    rules.push({
      pattern: JSON.parse(patternSrc) as (string | string[])[],
      decision: decision as Decision,
    })
  }
  return rules
}

function decide(
  rules: readonly Rule[],
  argv: readonly string[]
): Decision | null {
  let best: Decision | null = null
  for (const r of rules) {
    const hit =
      r.pattern.length <= argv.length &&
      r.pattern.every((alt, i) =>
        Array.isArray(alt) ? alt.includes(argv[i]!) : alt === argv[i]
      )
    if (hit && (best === null || STRICTNESS[r.decision] > STRICTNESS[best]))
      best = r.decision
  }
  return best
}

const rules = parseRules(LUMO_CODEX_RULES)
const argvOf = (p: string): string[] => ['lumo', ...p.split(' ')]

describe('Codex rules coverage (allow all lumo, prompt the risky ones)', () => {
  it('has exactly one allow rule (the bare lumo prefix) and only prompt rules otherwise', () => {
    const allows = rules.filter(r => r.decision === 'allow')
    expect(allows).toHaveLength(1)
    expect(allows[0]!.pattern).toEqual(['lumo'])
    expect(
      rules.filter(r => r.decision !== 'allow').map(r => r.decision)
    ).not.toContain('forbidden')
  })

  it.each(Object.entries(CODEX_CLASSES))(
    '`lumo %s`: serverOnly => allow, otherwise => prompt',
    (command, cls) => {
      expect(decide(rules, argvOf(command))).toBe(
        cls.serverOnly ? 'allow' : 'prompt'
      )
      // …also with trailing arguments, as Codex matches a prefix.
      expect(decide(rules, [...argvOf(command), 'X-1', '--json'])).toBe(
        cls.serverOnly ? 'allow' : 'prompt'
      )
    }
  )

  // Documented, pinned limitation: a rule matches the leading tokens, so a
  // flag before the command words evaluates to the catch-all allow. The CLI
  // refuses that ordering for every prompted command (codex-flag-order.ts).
  describe.each(Object.keys(CODEX_PROMPTED_COMMANDS))(
    'flag before the command words of `lumo %s`',
    command => {
      it.each([['--no-hints'], ['--project', 'x']])(
        'rules say allow for `lumo %s …` but the CLI guard refuses it',
        (...flag) => {
          const argv = [...flag, ...command.split(' ')]
          expect(decide(rules, ['lumo', ...argv])).toBe('allow')
          const err = codexFlagOrderError(argv, command)
          expect(err?.[0]).toMatch(/^Error: /)
          expect(err?.[1]).toMatch(/^Hint: .*`lumo /)
        }
      )
    }
  )

  it('server-only commands keep free flag order', () => {
    expect(isServerOnlyPath('task show')).toBe(true)
    expect(
      codexFlagOrderError(['--no-hints', 'task', 'show'], 'task show')
    ).toBeNull()
  })

  it('the prompted set is exactly the non-serverOnly classes', () => {
    expect(Object.keys(CODEX_PROMPTED_COMMANDS).sort()).toEqual(
      Object.entries(CODEX_CLASSES)
        .filter(([, c]) => !c.serverOnly)
        .map(([p]) => p)
        .sort()
    )
    for (const [p, c] of Object.entries(CODEX_CLASSES))
      expect(isCodexServerOnly(p.split(' '))).toBe(c.serverOnly)
  })

  it('`lumo skill read` is allowed (served from the package, SERVER_ONLY)', () => {
    expect(decide(rules, ['lumo', 'skill', 'read'])).toBe('allow')
    expect(decide(rules, ['lumo', 'skill', 'read', 'references/x.md'])).toBe(
      'allow'
    )
  })

  it('pins the known fail-open behaviour: an unclassified new command is allowed', () => {
    expect(decide(rules, ['lumo', 'some-new-command'])).toBe('allow')
  })

  it('`lumox status` and other binaries are matched by no rule', () => {
    expect(decide(rules, ['lumox', 'status'])).toBeNull()
    expect(decide(rules, ['git', 'status'])).toBeNull()
    expect(decide(rules, ['lumo'])).toBe('allow')
  })

  it('buildCodexRules takes the prompt list as input (one rule per path, shorter path subsumes longer)', () => {
    const text = buildCodexRules({ 'a b': 'x', a: 'y', 'c d': 'z' })
    const parsed = parseRules(text)
    expect(parsed.map(r => r.pattern)).toEqual([
      ['lumo'],
      ['lumo', 'a'],
      ['lumo', 'c', 'd'],
    ])
    expect(text).toContain('justification = "z"')
  })

  const codex = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  ;(codex.status === 0 ? it : it.skip)(
    'real `codex execpolicy check` loads the file (match/not_match examples validate) and agrees',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'lumo-rules-'))
      try {
        const file = join(dir, 'lumo.rules')
        writeFileSync(file, LUMO_CODEX_RULES)
        const run = (argv: string[]) => {
          const r = spawnSync(
            'codex',
            ['execpolicy', 'check', '--rules', file, '--', ...argv],
            { encoding: 'utf8' }
          )
          expect(r.status).toBe(0)
          return (
            (JSON.parse(r.stdout) as { decision?: Decision }).decision ?? null
          )
        }
        expect(run(['lumo', 'task', 'list'])).toBe('allow')
        expect(run(['lumo', 'skill', 'read'])).toBe('allow')
        expect(run(['lumo', 'doc', 'create', '--file', 'x'])).toBe('prompt')
        expect(run(['lumo', 'init'])).toBe('prompt')
        expect(run(['lumo', 'update'])).toBe('prompt')
        expect(run(['lumox', 'status'])).toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )
})
