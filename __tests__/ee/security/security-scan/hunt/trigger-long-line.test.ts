/**
 * @jest-environment node
 *
 * LUM-833 — the hunt trigger's callee scan used to be quadratic on one long
 * identifier-like run: a minified bundle or generated file committed in a PR
 * (200,000 characters on one line) took ~21 s per pass, and stage A runs the
 * trigger twice. Anchoring a match at the head of an identifier chain makes it
 * linear without changing which calls it finds.
 */
import {
  addedControlCallIds,
  calleesOf,
  evaluateHuntTrigger,
} from '@/lib/security-scan/hunt/trigger'

const file = (path: string, ...texts: string[]) => ({
  path,
  lines: texts.map((text, i) => ({ lineNo: i + 1, text })),
})

/** Wall-clock ms of one call. Generous bound: the bug was ~21,000 ms. */
function timed(fn: () => unknown): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

const LONG = 200_000

describe('a very long diff line does not slow the hunt trigger', () => {
  const shapes: Array<[string, string]> = [
    ['one identifier run', 'x'.repeat(LONG)],
    ['a run then a real sink', `${'x'.repeat(LONG)}; eval(input)`],
    ['a long member chain with no call', `a${'.b'.repeat(LONG / 2)}`],
    ['a minified-looking line', 'var a=b.c(d),e=f.g;'.repeat(LONG / 20)],
    ['a run of spaces after an identifier', `x${' '.repeat(LONG)}`],
  ]

  it.each(shapes)(
    '%s: the trigger finishes well under a second',
    (_n, text) => {
      const ms = timed(() =>
        evaluateHuntTrigger({
          files: [file('src/big.ts', text)],
          hasHighFinding: false,
          hasOpenL4Crossing: false,
        })
      )
      expect(ms).toBeLessThan(1000)
    }
  )

  it.each(shapes)(
    '%s: the control scan finishes well under a second',
    (_n, text) => {
      const ms = timed(() => addedControlCallIds([file('src/big.ts', text)]))
      expect(ms).toBeLessThan(1000)
    }
  )

  it('still finds the call at the end of the long run', () => {
    const out = evaluateHuntTrigger({
      files: [file('src/big.ts', `${'x'.repeat(LONG)}; eval(input)`)],
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })
    expect(out.reasons).toContain('diff:sink:eval')
  })
})

/**
 * The regex as it was before LUM-833, verbatim, and the walk that used it —
 * the reference the anchored scan is held to.
 */
const OLD_CALLEE_RE = /([A-Za-z_$][\w$]*(?:\.\$?[A-Za-z_$][\w$]*)*)\s*\(/g
function oldCalleesOf(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(OLD_CALLEE_RE)) {
    const captured = m[1] ?? ''
    out.push(
      m.index > 0 && text[m.index - 1] === '.' ? `.${captured}` : captured
    )
  }
  return out
}

describe('the boundary-anchored callee scan finds the same calls as before', () => {
  const corpus = [
    'const rows = await prisma.$queryRawUnsafe(sql)',
    'await db.$executeRaw`DELETE FROM t`',
    "exec(cmd, { shell: '/bin/sh' })",
    "import { exec } from 'node:child_process'; exec(userInput)",
    'const m = /re/.exec(s)',
    "const n = 'a,b'.split(',')",
    'const r = f().exec(x)',
    'const r2 = a[0].exec(x)',
    'const r3 = (await load()).run(q)',
    'await fetch(url, { method: "POST" })',
    'const out = eval(code)',
    'const fn = new Function(src)',
    'redirect(`/w/${slug}`)',
    'const { text } = await generateText({ model, prompt })',
    'return NextResponse.json(await service.list(workspaceId))',
    'if (!(await requireAuth(req))) return unauthorized()',
    'const parsed = schema.parse(await req.json())',
    'foo . bar ( baz )',
    'a.$b(c).d(e)(f)',
    '$(".sel").on("click", () => go())',
    '_private_(x); __proto__.call(y)',
    'x.y.z(1)  + w (2) + v\t(3)',
    'const s = "exec(not a call)"; run(s)',
    '// comment mentioning eval(x) and fetch(y)',
    'var a=b.c(d),e=f.g(h);function i(j){return k.l(m)}',
  ]

  it.each(corpus)('%s', line => {
    expect(calleesOf(line)).toEqual(oldCalleesOf(line))
  })

  it('keeps the receivers it cannot parse, and the method-vs-free-function distinction', () => {
    expect(calleesOf('const m = /re/.exec(s)')).toEqual(['.exec'])
    expect(calleesOf('const r = f().exec(x)')).toEqual(['f', '.exec'])
    expect(calleesOf('a[0].exec(x)')).toEqual(['.exec'])
    expect(calleesOf('exec(cmd)')).toEqual(['exec'])
    expect(calleesOf('cp.exec(cmd)')).toEqual(['cp.exec'])
    expect(calleesOf('prisma.$queryRawUnsafe(q)')).toEqual([
      'prisma.$queryRawUnsafe',
    ])
  })

  it('the trigger reasons over the corpus are unchanged', () => {
    const out = evaluateHuntTrigger({
      files: [file('app/api/x/route.ts', ...corpus)],
      hasHighFinding: false,
      hasOpenL4Crossing: false,
    })
    // Every sink the corpus writes, found — and nothing invented.
    expect(out.reasons.filter(r => r.startsWith('diff:sink:')).sort()).toEqual(
      [
        'diff:sink:child-process',
        'diff:sink:eval',
        'diff:sink:fetch',
        'diff:sink:llm-call',
        'diff:sink:new-function',
        'diff:sink:prisma-raw',
        'diff:sink:redirect',
      ].sort()
    )
  })

  it('the one documented difference: an identifier glued onto a digit is not a call', () => {
    // Not valid JS as a call; the old scan read `abc` out of `9abc(`.
    expect(oldCalleesOf('9abc(x)')).toEqual(['abc'])
    expect(calleesOf('9abc(x)')).toEqual([])
  })
})
