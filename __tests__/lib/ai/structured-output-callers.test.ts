/**
 * LUM-1304 — every `generateObject` call in a module that runs on a model with
 * a `STRUCTURED_OUTPUT_HOSTS` entry carries that routing. Under ZDR the
 * gateway otherwise also serves DeepSeek V4-Pro from baseten, which ignores
 * the schema and answers empty ("No object generated: the model did not
 * return a response"). A new call on these tiers that forgets the routing
 * fails here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  GENERATION_MODEL,
  MEMORY_JUDGE_MODEL,
  STRUCTURED_OUTPUT_HOSTS,
} from '@/lib/ai/models'

const ROOT = join(__dirname, '..', '..', '..')
/** The model constants whose id has an entry (the import names to look for). */
const ROUTED_CONSTANTS = ['MEMORY_JUDGE_MODEL', 'GENERATION_MODEL']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** The object literal passed to each `generateObject(`, brace-matched. */
function generateObjectArgs(source: string): string[] {
  const out: string[] = []
  let at = source.indexOf('generateObject({')
  while (at !== -1) {
    const open = at + 'generateObject('.length
    let depth = 0
    let end = open
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++
      else if (source[end] === '}' && --depth === 0) break
    }
    out.push(source.slice(open, end + 1))
    at = source.indexOf('generateObject({', end)
  }
  return out
}

describe('LUM-1304 structured-output routing on every routed caller', () => {
  it('both routed constants resolve to an id that has hosts', () => {
    expect(STRUCTURED_OUTPUT_HOSTS[MEMORY_JUDGE_MODEL]).toBeDefined()
    expect(STRUCTURED_OUTPUT_HOSTS[GENERATION_MODEL]).toBeDefined()
  })

  const callers = ['lib', 'ee']
    .flatMap(d => sourceFiles(join(ROOT, d)))
    .filter(f => !f.endsWith(join('lib', 'ai', 'models.ts')))
    .map(f => ({ file: relative(ROOT, f), source: readFileSync(f, 'utf8') }))
    .filter(
      ({ source }) =>
        source.includes('generateObject({') &&
        ROUTED_CONSTANTS.some(c => source.includes(c))
    )

  it('finds the known callers (the scan itself works)', () => {
    expect(callers.length).toBeGreaterThanOrEqual(17)
  })

  it.each(callers.map(c => [c.file, c.source] as const))(
    '%s routes every generateObject call',
    (_file, source) => {
      for (const args of generateObjectArgs(source))
        expect(args).toMatch(
          /structuredOutputCallOptions\(|providerOptions(,|\s*:)/
        )
    }
  )
})
