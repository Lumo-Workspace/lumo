/**
 * @jest-environment node
 *
 * LUM-1150 follow-up — the names a suggestion uses that its file neither
 * defines, imports nor gets from the language (see suggestion-scope.ts).
 */
import { unknownSuggestionNames } from '@/ee/security/security-scan/suggestion-scope'

describe('LUM-1150 unknownSuggestionNames', () => {
  const file = [
    "import { exec } from 'child_process'",
    'const items = load()',
    'function load() { return [] }',
  ].join('\n')

  it('names the call that is neither defined, imported nor a built-in', () => {
    expect(
      unknownSuggestionNames({
        code: "execFile('ls', [dir])",
        fileText: file + '\nconst dir = 1',
        filePath: 'a.ts',
      })
    ).toEqual(['execFile'])
  })

  it('ignores names inside strings and comments', () => {
    expect(
      unknownSuggestionNames({
        code: "exec('execFile(x)') // use spawnSync() later",
        fileText: file,
        filePath: 'a.ts',
      })
    ).toEqual([])
  })

  it('ignores member calls and keywords, and knows arrow parameters', () => {
    expect(
      unknownSuggestionNames({
        code: 'if (items.length) return items.map(item => item.name.trim())',
        fileText: file,
        filePath: 'a.ts',
      })
    ).toEqual([])
  })

  it('knows names the suggestion itself declares', () => {
    expect(
      unknownSuggestionNames({
        code: [
          'const safe = (d: string) => d.replace(/x/g, "")',
          'function run(cmd: string) { return safe(cmd) }',
          'run(safe("a"))',
        ].join('\n'),
        fileText: file,
        filePath: 'a.ts',
      })
    ).toEqual([])
  })

  it('handles Python imports and comments', () => {
    const py = [
      'import os',
      '',
      'def ls(d):',
      '    return os.system("ls " + d)',
    ].join('\n')
    expect(
      unknownSuggestionNames({
        code: '    return subprocess.run(["ls", d])  # safer',
        fileText: py,
        filePath: 'tool.py',
      })
    ).toEqual(['subprocess'])
    expect(
      unknownSuggestionNames({
        code: '    return sorted(os.listdir(d))',
        fileText: py,
        filePath: 'tool.py',
      })
    ).toEqual([])
  })
})

describe('LUM-1150 unknownSuggestionNames — what does not vouch for a name', () => {
  it('a member name or object key elsewhere in the file is not a binding', () => {
    const file = [
      "import * as cp from 'child_process'",
      'const run = (d: string) => cp.execFile("ls", [d])',
    ].join('\n')
    expect(
      unknownSuggestionNames({
        code: 'execFile("ls", [d])',
        fileText: file,
        filePath: 'a.ts',
      })
    ).toEqual(['execFile'])
    expect(
      unknownSuggestionNames({
        code: 'cp.execFile("ls", [d])',
        fileText: file,
        filePath: 'a.ts',
      })
    ).toEqual([])
  })

  it('crypto is not a built-in: Node needs it imported for createHash', () => {
    expect(
      unknownSuggestionNames({
        code: "crypto.createHash('sha256')",
        fileText: 'export const x = 1',
        filePath: 'a.ts',
      })
    ).toEqual(['crypto'])
  })

  it("another language's built-ins never vouch for a name", () => {
    expect(
      unknownSuggestionNames({
        code: 'len(items)',
        fileText: 'const items = []',
        filePath: 'a.ts',
      })
    ).toEqual(['len'])
    expect(
      unknownSuggestionNames({
        code: 'len(items)',
        fileText: 'items = []',
        filePath: 'a.py',
      })
    ).toEqual([])
  })
})
