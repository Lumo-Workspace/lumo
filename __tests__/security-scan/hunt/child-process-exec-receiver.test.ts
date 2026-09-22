/** @jest-environment node */
/**
 * LUM-809 — `exec` is the one name in `SINK_RULES` that collides with the
 * standard library: `RegExp.prototype.exec` is a string match, `child_process.exec`
 * runs a command. The rule used to accept either, so every regex in a diff lit
 * the injection hunt. On LUM-808's scan (PR #1046) the whole trigger surface was
 * two regex literals in a test file, and the search spent 97,432 tokens on them.
 *
 * The two read paths fail differently, so both are pinned here:
 *   - the text trigger cannot see a receiver it has no grammar for, so
 *     `/re/.exec(s)` arrives looking exactly like an imported `exec(cmd)`;
 *   - the AST path drops a regex-literal receiver already (`calleeText` returns
 *     null), but hands `RE.exec` to the same table.
 */
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { evaluateHuntTrigger } from '@/lib/security-scan/hunt/trigger'
import { calleeText } from '@/lib/security-scan/graph/build-subgraph'
import { matchCallRule, SINK_RULES } from '@/lib/security-scan/graph/patterns'
import { matchSinkRule } from '@/lib/security-scan/hunt/repo-symbols'

/** The text path: one added line in a graph-source file. */
function textSinks(...texts: string[]): string[] {
  return evaluateHuntTrigger({
    files: [
      {
        path: 'lib/x.ts',
        lines: texts.map((text, i) => ({ lineNo: i + 1, text })),
      },
    ],
    hasHighFinding: false,
    hasOpenL4Crossing: false,
  }).reasons.filter(r => r.startsWith('diff:sink:'))
}

/** The AST path: what `calleeText` makes of the first call, then the table. */
function astSink(source: string): string | null {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true)
  let callee: string | null = null
  const walk = (n: ts.Node): void => {
    if (callee === null && ts.isCallExpression(n))
      callee = calleeText(n.expression)
    n.forEachChild(walk)
  }
  walk(sf)
  return callee === null
    ? null
    : (matchCallRule(SINK_RULES, callee)?.id ?? null)
}

describe('LUM-809 child-process sink: the receiver decides', () => {
  it('regex exec is not a child-process sink on either path', () => {
    // Both regex shapes, on the path that saw both as child-process calls.
    expect(
      textSinks('const block = /enum X \\{([\\s\\S]*?)\\n\\}/.exec(schema)')
    ).toEqual([])
    expect(textSinks('while ((m = modelRe.exec(schema)) !== null) {')).toEqual(
      []
    )

    // The AST path drops a literal receiver on its own; an identifier one is
    // the shape it used to mis-file.
    expect(astSink('const m = /a(b)c/.exec(s)')).toBeNull()
    expect(astSink('const m = RE.exec(s)')).toBeNull()
  })

  it('real child_process calls are still child-process sinks on both paths', () => {
    // A bare call cannot be `RegExp.prototype.exec` — that always has a receiver.
    expect(textSinks('  const out = exec(cmd)')).toEqual([
      'diff:sink:child-process',
    ])
    expect(textSinks('  child_process.exec(cmd)')).toEqual([
      'diff:sink:child-process',
    ])
    for (const call of [
      'execSync(cmd)',
      'execFile(bin, args)',
      'execFileSync(bin, args)',
      'spawn(bin, args)',
      'spawnSync(bin, args)',
      'cp.spawnSync(bin, args)',
    ]) {
      expect(textSinks(`  const r = ${call}`)).toEqual([
        'diff:sink:child-process',
      ])
    }

    expect(astSink('const out = exec(cmd)')).toBe('child-process')
    expect(astSink('child_process.exec(cmd)')).toBe('child-process')
    expect(astSink('const r = cp.spawnSync(bin, args)')).toBe('child-process')
  })

  it('detection narrowed but placement stayed permissive', () => {
    // The asymmetry is the whole design and a future "unify these two" pass is
    // exactly what would undo it: detecting a sink from a raw line pays a
    // six-figure budget for a wrong guess, while placing one an agent already
    // named pays nothing and refusing it is the LUM-798 over-rejection.
    expect(matchCallRule(SINK_RULES, 'cp.exec')).toBeNull()
    expect(matchSinkRule('cp.exec')?.id).toBe('child-process')
    expect(matchSinkRule('lib/x.ts#cp.exec@12')?.id).toBe('child-process')
  })

  it('no dot-exec call site in the repo reads as a child-process sink', () => {
    // The real inventory, not a fixture: every tracked line that calls `.exec(`
    // on something. The module-qualified forms are the ones that SHOULD hit, so
    // they are the only exclusion — anything else hitting means the collision is
    // back.
    const out = execFileSync(
      'git',
      ['grep', '-I', '-hE', '\\.exec\\(', '--', '*.ts', '*.tsx'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
    const lines = out
      .split('\n')
      .filter(l => l.includes('.exec('))
      .filter(l => !/\b(child_process|childProcess)\.exec\(/.test(l))

    // A sweep that swept nothing would pass for the wrong reason.
    expect(lines.length).toBeGreaterThan(50)

    const hits = lines.filter(l =>
      textSinks(l).includes('diff:sink:child-process')
    )
    expect(hits).toEqual([])
  })
})
