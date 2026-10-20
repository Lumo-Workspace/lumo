/**
 * @jest-environment node
 *
 * LUM-1233 batch 4 (CX-1) — the Codex rules come from the `.codex()` class
 * declared on each command (emit-grammar → grammar.json →
 * codex-classes.generated.ts), not from hand-kept lists. Pinned against the
 * last hand-kept lists (fixtures, copied from codex-rules.ts at b9a2ede):
 * identical except the deviations listed here, each with its reason.
 */
import fs from 'fs'
import path from 'path'
import {
  CODEX_FILE_READING_COMMANDS,
  CODEX_SANDBOXED_COMMANDS,
  CODEX_SERVER_ONLY_COMMANDS,
  LUMO_CODEX_RULES,
  buildCodexRules,
  isCodexServerOnly,
} from '@/cli/src/lib/codex-rules'
import { TOMBSTONES } from '@/cli/src/lib/removed-commands'
import { CODEX_CLASSES } from '@/cli/src/lib/codex-classes.generated'
import {
  codexClassesSource,
  extractGrammar,
  type CliGrammar,
  type CommandLike,
} from '@/scripts/cli-grammar/grammar'

const root = path.resolve(__dirname, '../..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')
const hand = JSON.parse(
  read('__tests__/fixtures/lum1233-codex-hand-lists.json')
) as {
  serverOnly: string[]
  fileReading: Record<string, string>
  sandboxed: Record<string, string>
}
const handRules = read('__tests__/fixtures/lum1233-codex-hand-rules.txt')
const grammar = JSON.parse(
  read('scripts/cli-grammar/grammar.json')
) as CliGrammar

/**
 * The only differences from the hand-kept lists. `priority` was allowed as a
 * whole group, which also let the removed `lumo priority "<text>"` (a 3f
 * tombstone) run outside the sandbox; the class now sits on the two live
 * leaves, so the tombstone stays sandboxed (it only prints its error anyway).
 * `task search` (2026-10-19) folded into `task list` and became a tombstone:
 * the generated list loses exactly that entry, `task list` keeps its class.
 */
const DEVIATIONS = {
  serverOnlyRemoved: ['priority', 'task search'],
  serverOnlyAdded: [
    // LUM-1240: new commands, classified where they are defined.
    'feedback list',
    'feedback show',
    'priority create',
    'priority list',
    // LUM-1285: project archive / unarchive.
    'project archive',
    'project unarchive',
  ],
  // LUM-1240: `feedback create` reads the --evidence-file it uploads.
  fileReadingAdded: { 'feedback create': '--evidence-file' } as Record<
    string,
    string
  >,
  sandboxedAdded: {
    'feedback create':
      'reads local files (--file …) — Codex asks first (--evidence-file)',
    // LUM-1255: reads git and the working tree, so it stays sandboxed;
    // LUM-1256: it also reads server context from the Lumo API, which inside
    // the sandbox falls back to the cache (or no context).
    'security scan':
      'reads git and the working tree; reads server context from the Lumo API and caches it in ~/.lumo (sandboxed: falls back to the cache)',
  } as Record<string, string>,
}

/**
 * LUM-1233 3j renamed some commands after batch 4 (names only — the class
 * of each stays, pinned in lum1233-3j-renames.test.ts); apply those renames
 * to the hand-kept lists before comparing.
 */
const renames = (
  JSON.parse(read('__tests__/fixtures/lum1233-3j-renames.json')) as {
    renames: Record<string, string[]>
  }
).renames
const renamePath = (p: string): string[] => renames[p] ?? [p]
const renameKeys = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(m).flatMap(([k, v]) => renamePath(k).map(n => [n, v]))
  )
const handServerOnly = hand.serverOnly.flatMap(renamePath)

describe('generated lists vs the last hand-kept ones', () => {
  it('server-only: identical (after the 3j renames) except the listed deviations', () => {
    const now = new Set(CODEX_SERVER_ONLY_COMMANDS)
    const before = new Set(handServerOnly)
    expect([...before].filter(p => !now.has(p)).sort()).toEqual(
      DEVIATIONS.serverOnlyRemoved
    )
    expect([...now].filter(p => !before.has(p)).sort()).toEqual(
      DEVIATIONS.serverOnlyAdded
    )
  })

  it('file-reading and sandboxed: entry for entry identical (after the 3j renames)', () => {
    expect(CODEX_FILE_READING_COMMANDS).toEqual({
      ...renameKeys(hand.fileReading),
      ...DEVIATIONS.fileReadingAdded,
    })
    expect(CODEX_SANDBOXED_COMMANDS).toEqual({
      ...renameKeys(hand.sandboxed),
      ...DEVIATIONS.sandboxedAdded,
    })
  })

  it('the rules file is the hand-kept one, except the priority rule and the 3j names', () => {
    // The fixture is exactly what the hand-kept lists produced…
    expect(buildCodexRules(hand.serverOnly, hand.sandboxed)).toBe(handRules)
    // …and applying the deviation and the renames to those lists gives today's file.
    const adjusted = [
      ...handServerOnly.filter(p => !DEVIATIONS.serverOnlyRemoved.includes(p)),
      ...DEVIATIONS.serverOnlyAdded,
    ]
    expect(LUMO_CODEX_RULES).toBe(
      buildCodexRules(adjusted, {
        ...renameKeys(hand.sandboxed),
        ...DEVIATIONS.sandboxedAdded,
      })
    )
    expect(LUMO_CODEX_RULES).toContain(
      'pattern = ["lumo", "priority", ["create", "list"]]'
    )
  })
})

describe('every command is classified where it is defined', () => {
  it("each grammar leaf has a class (its own or a group's), declared once on its path", () => {
    const paths = Object.keys(grammar.commands)
    for (const p of paths) {
      const node = grammar.commands[p]!
      const words = p.split(' ')
      const declaring = words
        .map((_, i) => words.slice(0, i + 1).join(' '))
        .filter(q => grammar.commands[q]?.codex !== undefined)
      if (!node.hasSubcommands)
        expect({ p, n: declaring.length }).toEqual({ p, n: 1 })
      else expect(declaring.length).toBeLessThanOrEqual(1)
    }
  })

  it('a server-only class never touches local files; every other class says why', () => {
    for (const n of Object.values(grammar.commands)) {
      if (!n.codex) continue
      if (n.codex.serverOnly) expect(n.codex.localFiles).toBe('none')
      else expect(n.codex.detail.length).toBeGreaterThan(0)
    }
  })

  it('codex-classes.generated.ts holds exactly the classes in grammar.json', () => {
    // emit-grammar writes both from one extraction (prettier-formatted, so
    // compared by value here); a stale module fails this.
    const declared = Object.fromEntries(
      Object.entries(grammar.commands).flatMap(([p, n]) =>
        n.codex ? [[p, n.codex]] : []
      )
    )
    expect(CODEX_CLASSES).toEqual(declared)
    expect(codexClassesSource(grammar)).toContain('export const CODEX_CLASSES')
  })

  it('emit-grammar refuses a leaf without a class, and a class declared twice on a path', () => {
    const cmd = (
      name: string,
      commands: CommandLike[] = [],
      codexClass?: CommandLike['codexClass']
    ): CommandLike => ({
      name: () => name,
      description: () => '',
      commands,
      options: [],
      codexClass,
    })
    const ok = { serverOnly: true as const, localFiles: 'none' as const }
    expect(() => extractGrammar(cmd('lumo', [cmd('fresh')]), '0.0.0')).toThrow(
      /without a Codex class.*fresh/
    )
    expect(() =>
      extractGrammar(
        cmd('lumo', [cmd('g', [cmd('leaf', [], ok)], ok)]),
        '0.0.0'
      )
    ).toThrow(/declared again below a group.*g leaf/)
    expect(
      Object.keys(
        extractGrammar(cmd('lumo', [cmd('g', [cmd('leaf')], ok)]), '0.0.0')
          .commands
      )
    ).toEqual(['g', 'g leaf'])
  })
})

describe('tombstones', () => {
  it('no removed command is allowed outside the sandbox', () => {
    for (const t of TOMBSTONES) {
      const node = grammar.commands[t.path]
      // A tombstone on a live leaf is a removed argument shape of a command
      // that still exists (e.g. `task list -p`); only the live leaf is allowed.
      if (node && !node.hasSubcommands) continue
      expect({
        path: t.path,
        allowed: isCodexServerOnly(t.path.split(' ')),
      }).toEqual({ path: t.path, allowed: false })
    }
  })
})
