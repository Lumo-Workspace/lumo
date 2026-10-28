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
  CODEX_PROMPTED_COMMANDS,
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
    // LUM-1292: reads only files inside the CLI package.
    'skill read',
  ],
  // LUM-1240: `feedback create` reads the --evidence-file it uploads.
  // LUM-1321 / LUM-1333: `review import` reads the report it sends.
  fileReadingAdded: {
    'feedback create': '--evidence-file',
    'review import': 'reads the report file <file> and uploads it to Lumo',
  } as Record<string, string>,
  sandboxedAdded: {
    'feedback create':
      'reads local files (--file …) — Codex asks first (--evidence-file)',
    'review import':
      'reads local files (--file …) — Codex asks first (reads the report file <file> and uploads it to Lumo)',
    // LUM-1255: reads git and the working tree, so it stays sandboxed;
    // LUM-1256: it also reads server context from the Lumo API, which inside
    // the sandbox falls back to the cache (or no context);
    // LUM-1257: its --deps calls api.osv.dev, so inside Codex that needs network.
    'security scan':
      'reads git and the working tree; reads server context from the Lumo API and caches it in ~/.lumo (sandboxed: falls back to the cache); --deps sends package names and versions to api.osv.dev (needs network); --full runs osv-scanner from PATH',
    // LUM-1292: init / uninstall touch only the repo's hooks/rules; doctor now also
    // probes the Lumo API (login + connectivity).
    init: 'writes hook and rules files in this repo',
    uninstall: 'deletes hook and rules entries in this repo',
    doctor:
      "reads this repo's Lumo files and probes the Lumo API (inside Codex's sandbox the API shows as unreachable)",
  } as Record<string, string>,
  // LUM-1292: `skill status` / `skill update` were deleted.
  sandboxedRemoved: ['skill status', 'skill update'],
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
    const sandboxed: Record<string, string> = {
      ...renameKeys(hand.sandboxed),
      ...DEVIATIONS.sandboxedAdded,
    }
    for (const p of DEVIATIONS.sandboxedRemoved) delete sandboxed[p]
    expect(CODEX_SANDBOXED_COMMANDS).toEqual(sandboxed)
  })

  it('the rules file prompts exactly the non-server-only commands (LUM-1292)', () => {
    const prompted = Object.keys(CODEX_SANDBOXED_COMMANDS).sort()
    expect(Object.keys(CODEX_PROMPTED_COMMANDS).sort()).toEqual(prompted)
    expect(LUMO_CODEX_RULES).toBe(buildCodexRules())
    expect(LUMO_CODEX_RULES).toContain(
      'pattern = ["lumo"],\n    decision = "allow"'
    )
    expect(LUMO_CODEX_RULES).not.toContain('"priority"')
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
