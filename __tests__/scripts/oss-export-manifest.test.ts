/** @jest-environment node */
import { execFileSync } from 'child_process'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import {
  applyTransform,
  classifyFiles,
  extractPathTokens,
  extractSpecifiers,
  findDanglingConfigRefs,
  findImportViolations,
  findUncoveredConfigFiles,
  importCheckInput,
  parseConfigRefFiles,
  globToRegExp,
  isOutsideDir,
  matchesGlob,
  resolveSpecifier,
  scanMarkers,
  summarizePaths,
  transformTargets,
  type ConfigRefFile,
  type OssManifest,
} from '../../scripts/oss-export/manifest'
import * as boundary from '../../test-utils/ee/plugin-boundary'

const rule = (glob: string) => ({ glob, reason: 'test' })

describe('globToRegExp / matchesGlob', () => {
  it('`**` spans directories, `*` stays inside one segment', () => {
    expect(matchesGlob('app/a/b/page.tsx', 'app/**')).toBe(true)
    expect(matchesGlob('app', 'app/**')).toBe(false)
    expect(matchesGlob('scripts/_check.ts', 'scripts/_*.ts')).toBe(true)
    expect(matchesGlob('scripts/x/_check.ts', 'scripts/_*.ts')).toBe(false)
    expect(matchesGlob('a/b/c.test.ts', '**/*.test.ts')).toBe(true)
    expect(matchesGlob('c.test.ts', '**/*.test.ts')).toBe(true)
  })

  it('treats regex metacharacters in globs literally', () => {
    expect(matchesGlob('mcp.json', 'mcp.json')).toBe(true)
    expect(matchesGlob('mcpXjson', 'mcp.json')).toBe(false)
    expect(globToRegExp('a?c').test('abc')).toBe(true)
    expect(globToRegExp('a?c').test('a/c')).toBe(false)
  })

  it('a single-segment glob does not reach into subdirectories', () => {
    // .claude/skills/* are symlinks into .agents/; nested files are not matched.
    expect(matchesGlob('.claude/skills/clerk', '.claude/skills/*')).toBe(true)
    expect(
      matchesGlob('.claude/skills/clerk/SKILL.md', '.claude/skills/*')
    ).toBe(false)
  })
})

describe('classifyFiles (default deny)', () => {
  const manifest: Pick<OssManifest, 'include' | 'exclude'> = {
    include: [rule('app/**'), rule('scripts/**'), rule('package.json')],
    exclude: [rule('scripts/analysis/**'), rule('.planning/**')],
  }

  it('exports only files an include matches and no exclude matches', () => {
    const cls = classifyFiles(
      ['app/page.tsx', 'scripts/lint.ts', 'scripts/analysis/x.ts'],
      manifest
    )
    expect(cls.included).toEqual(['app/page.tsx', 'scripts/lint.ts'])
    expect(cls.excluded).toEqual(['scripts/analysis/x.ts'])
    expect(cls.unclassified).toEqual([])
  })

  it('reports a new top-level path that neither list mentions as unclassified', () => {
    const cls = classifyFiles(
      ['app/page.tsx', 'internal-notes/plan.md', 'secrets.txt'],
      manifest
    )
    expect(cls.unclassified).toEqual(['internal-notes/plan.md', 'secrets.txt'])
    expect(cls.included).toEqual(['app/page.tsx'])
  })

  it('exclude wins over include inside an allowed tree', () => {
    const cls = classifyFiles(['scripts/analysis/deep/a.json'], manifest)
    expect(cls.excluded).toEqual(['scripts/analysis/deep/a.json'])
    expect(cls.included).toEqual([])
  })

  it('lists rules that match nothing (stale manifest entries)', () => {
    const cls = classifyFiles(['app/page.tsx'], manifest)
    expect(cls.unusedRules.map(r => r.glob)).toEqual([
      'scripts/**',
      'package.json',
      'scripts/analysis/**',
      '.planning/**',
    ])
  })

  it('summarizePaths groups unclassified files by directory', () => {
    expect(
      summarizePaths(['new/a/1.ts', 'new/a/2.ts', 'new/b.ts', 'TOP.md'])
    ).toEqual(['TOP.md', 'new/a/ (2 files)', 'new/b.ts'])
  })
})

describe('import graph guard', () => {
  it('extracts static, side-effect, dynamic, require and jest.mock specifiers', () => {
    const src = [
      "import a from '@/lib/a'",
      "import './side'",
      "export { b } from '../b'",
      "const c = await import('./c')",
      "const d = require('../../scripts/analysis/d')",
      "jest.mock('@/lib/e', () => ({}))",
      "import type { F } from 'react'",
    ].join('\n')
    expect(extractSpecifiers(src).sort()).toEqual(
      [
        '../../scripts/analysis/d',
        '../b',
        './c',
        './side',
        '@/lib/a',
        '@/lib/e',
        'react',
      ].sort()
    )
  })

  it('resolves @/ and relative specifiers to tracked files, ignores packages', () => {
    const files = new Set([
      'lib/a.ts',
      'lib/dir/index.ts',
      'scripts/analysis/g.json',
    ])
    expect(resolveSpecifier('__tests__/x.test.ts', '@/lib/a', files)).toBe(
      'lib/a.ts'
    )
    expect(resolveSpecifier('lib/b.ts', './dir', files)).toBe(
      'lib/dir/index.ts'
    )
    expect(
      resolveSpecifier(
        '__tests__/cli/x.ts',
        '../../scripts/analysis/g.json',
        files
      )
    ).toBe('scripts/analysis/g.json')
    expect(resolveSpecifier('lib/b.ts', 'react', files)).toBeNull()
    // ESM-style `.js` specifier of a TypeScript source (cli/ uses these).
    expect(resolveSpecifier('lib/b.ts', './a.js', files)).toBe('lib/a.ts')
  })

  it('flags an exported file that imports an excluded one, by import not by path prefix', () => {
    const sources: Record<string, string> = {
      // Lives under a public path but reaches into the private tree.
      '__tests__/lib/redaction.test.ts':
        "import { classify } from '../../scripts/analysis/stock/classify'",
      '__tests__/lib/ok.test.ts': "import { a } from '@/lib/a'",
      'lib/a.ts': 'export const a = 1',
    }
    const violations = findImportViolations(
      [
        '__tests__/lib/redaction.test.ts',
        '__tests__/lib/ok.test.ts',
        'lib/a.ts',
      ],
      ['scripts/analysis/stock/classify.ts'],
      p => sources[p] ?? ''
    )
    expect(violations).toEqual([
      {
        from: '__tests__/lib/redaction.test.ts',
        specifier: '../../scripts/analysis/stock/classify',
        target: 'scripts/analysis/stock/classify.ts',
      },
    ])
  })
})

describe('import check sees the overlay (LUM-1065, RFC §6.3)', () => {
  const sources: Record<string, string> = {
    'lib/plugins/registry.ts':
      "import { INSTALLED_SERVER_PLUGINS } from './installed'",
    // The ref's version names the private plugin…
    'lib/plugins/installed.ts': "import { p } from '@/ee/security/server'",
    'ee/security/server.ts': 'export const p = 1',
  }
  // …the overlay's version is the empty list.
  const overlay: Record<string, string> = {
    'lib/plugins/installed.ts':
      "import type { P } from '@/lib/plugins/types'\nexport const L: readonly P[] = []",
    'lib/plugins/types.ts': 'export type P = 1',
  }
  const cls = {
    included: ['lib/plugins/registry.ts', 'lib/plugins/types.ts'],
    excluded: ['lib/plugins/installed.ts', 'ee/security/server.ts'],
  }
  const read = (p: string) => overlay[p] ?? sources[p] ?? ''

  it('without the overlay, importing the excluded list is a violation', () => {
    const check = importCheckInput(cls, [])
    expect(
      findImportViolations(
        check.importers,
        check.excluded,
        p => sources[p] ?? ''
      )
    ).toEqual([
      {
        from: 'lib/plugins/registry.ts',
        specifier: './installed',
        target: 'lib/plugins/installed.ts',
      },
    ])
  })

  it('an overlaid path counts as present and is checked with the overlay content', () => {
    const check = importCheckInput(cls, [
      'lib/plugins/installed.ts',
      'CLAUDE.md',
    ])
    expect(check.excluded).toEqual(['ee/security/server.ts'])
    expect(check.importers).toContain('lib/plugins/installed.ts')
    expect(check.importers).not.toContain('CLAUDE.md')
    expect(findImportViolations(check.importers, check.excluded, read)).toEqual(
      []
    )
  })

  it('an overlay that itself imports an excluded file is still caught', () => {
    const check = importCheckInput(cls, ['lib/plugins/installed.ts'])
    const leaky = (p: string) =>
      p === 'lib/plugins/installed.ts'
        ? "import { p } from '@/ee/security/server'"
        : read(p)
    expect(
      findImportViolations(check.importers, check.excluded, leaky)
    ).toEqual([
      {
        from: 'lib/plugins/installed.ts',
        specifier: '@/ee/security/server',
        target: 'ee/security/server.ts',
      },
    ])
  })
})

describe('transforms', () => {
  it('jsonArrayFilter drops matching elements and keeps 2-space JSON (LUM-1065)', () => {
    const src = JSON.stringify({
      buildCommand: 'b',
      crons: [
        { path: '/api/cron/keep', schedule: '1' },
        { path: '/api/cron/plugin-a', schedule: '2' },
        { path: '/api/cron/plugin-ab', schedule: '3' },
      ],
    })
    const out = applyTransform(src, {
      file: 'vercel.json',
      type: 'jsonArrayFilter',
      path: ['crons'],
      key: 'path',
      pattern: '^/api/cron/(plugin-a)$',
      reason: 't',
    })
    expect(JSON.parse(out)).toEqual({
      buildCommand: 'b',
      crons: [
        { path: '/api/cron/keep', schedule: '1' },
        { path: '/api/cron/plugin-ab', schedule: '3' },
      ],
    })
    expect(out.endsWith('}\n')).toBe(true)
  })

  it('jsonArrayFilter leaves the file byte-identical when nothing matches or the array is missing', () => {
    const t = {
      file: 'vercel.json',
      type: 'jsonArrayFilter' as const,
      path: ['crons'],
      key: 'path',
      pattern: '^/x$',
      reason: 't',
    }
    const src = '{"crons":[{"path":"/y"}]}'
    expect(applyTransform(src, t)).toBe(src)
    expect(applyTransform('{"a":1}', t)).toBe('{"a":1}')
  })

  it('jsonDelete removes a key path and keeps 2-space JSON', () => {
    const out = applyTransform(
      JSON.stringify({ scripts: { a: 'x', 'oss:export': 'y' } }),
      {
        file: 'package.json',
        type: 'jsonDelete',
        paths: [['scripts', 'oss:export']],
        reason: 't',
      }
    )
    expect(out).toBe('{\n  "scripts": {\n    "a": "x"\n  }\n}\n')
  })

  it('jsonDelete leaves the file byte-identical when the key is absent', () => {
    const src = '{"scripts":{"a":"x"}}'
    expect(
      applyTransform(src, {
        file: 'package.json',
        type: 'jsonDelete',
        paths: [['scripts', 'oss:export']],
        reason: 't',
      })
    ).toBe(src)
  })

  it('dropLines removes matching lines only', () => {
    expect(
      applyTransform('a\nscripts/analysis/x.json\nb\n', {
        file: '.prettierignore',
        type: 'dropLines',
        pattern: '^scripts/analysis/',
        reason: 't',
      })
    ).toBe('a\nb\n')
  })

  it('replace cuts a multiline section and rewrites a phrase (LUM-1078)', () => {
    const src = '# A\nkeep\n# --\n# Plugin\nX=1\n# --\n# B\nkeep\n'
    expect(
      applyTransform(src, {
        file: '.env.example',
        type: 'replace',
        pattern: '^# --\\n# Plugin\\n[\\s\\S]*?(?=^# --\\n# B$)',
        replacement: '',
        reason: 't',
      })
    ).toBe('# A\nkeep\n# --\n# B\nkeep\n')
    expect(
      applyTransform('a (x, y) b\nc (x, y)\n', {
        file: 'f',
        type: 'replace',
        pattern: ', y\\)',
        replacement: ')',
        reason: 't',
      })
    ).toBe('a (x) b\nc (x)\n')
  })

  it('replace leaves the file byte-identical when nothing matches', () => {
    const src = 'a\nb\n'
    expect(
      applyTransform(src, {
        file: 'f',
        type: 'replace',
        pattern: '^zzz$',
        replacement: 'q',
        reason: 't',
      })
    ).toBe(src)
  })
})

describe('localeKeys transform and glob targets (LUM-1081)', () => {
  const locale = (o: Record<string, string>) =>
    `${JSON.stringify(o, null, 2)}\n`

  it('deletes matching keys and promotes `oss.` variants in place', () => {
    const src = locale({
      a: 'keep',
      'plugin.x': 'gone',
      b: 'hosted text',
      'oss.b': 'snapshot text',
      c: 'keep too',
    })
    expect(
      applyTransform(src, {
        file: 'lib/i18n/*.json',
        type: 'localeKeys',
        delete: '^plugin\\.',
        promote: 'oss.',
        reason: 't',
      })
    ).toBe(locale({ a: 'keep', b: 'snapshot text', c: 'keep too' }))
  })

  it('a variant whose key is gone fails the export instead of shipping', () => {
    const src = locale({ 'oss.b': 'snapshot text', a: 'x' })
    expect(() =>
      applyTransform(src, {
        file: 'f.json',
        type: 'localeKeys',
        promote: 'oss.',
        reason: 't',
      })
    ).toThrow('oss.b has no b')
  })

  it('leaves the file byte-identical when nothing matches', () => {
    const src = '{\n  "a": "x"\n}\n'
    expect(
      applyTransform(src, {
        file: 'f.json',
        type: 'localeKeys',
        delete: '^zzz',
        promote: 'oss.',
        reason: 't',
      })
    ).toBe(src)
  })

  it('transformTargets: a plain path names one file, a glob every match', () => {
    const files = [
      'lib/i18n/en.json',
      'lib/i18n/de.json',
      'lib/i18n/x.ts',
      'a.json',
    ]
    expect(transformTargets({ file: 'a.json' }, files)).toEqual(['a.json'])
    expect(transformTargets({ file: 'missing.json' }, files)).toEqual([])
    expect(transformTargets({ file: 'lib/i18n/*.json' }, files)).toEqual([
      'lib/i18n/de.json',
      'lib/i18n/en.json',
    ])
    expect(transformTargets({ file: 'nope/*.json' }, files)).toEqual([])
  })
})

describe('output scans', () => {
  it('scanMarkers reports file, line and marker id — never the matched text', () => {
    const hits = scanMarkers(
      'lib/x.ts',
      'ok\n// see scripts/analysis/lum1\nok',
      [{ id: 'excluded-dir', pattern: 'scripts/analysis', reason: 't' }]
    )
    expect(hits).toEqual([
      { file: 'lib/x.ts', line: 2, markerId: 'excluded-dir' },
    ])
    expect(JSON.stringify(hits)).not.toContain('lum1')
  })

  it('scanMarkers applies a file-scoped marker only to matching files (LUM-1078)', () => {
    const marker = {
      id: 'plugin-env:docs',
      pattern: 'LUMO_MANAGED_SCAN',
      files: ['.env.example', 'docs/**'],
      reason: 't',
    }
    expect(scanMarkers('lib/x.ts', 'LUMO_MANAGED_SCAN', [marker])).toEqual([])
    expect(
      scanMarkers('docs/self-hosting/cron.md', 'a\nLUMO_MANAGED_SCAN', [marker])
    ).toEqual([
      {
        file: 'docs/self-hosting/cron.md',
        line: 2,
        markerId: 'plugin-env:docs',
      },
    ])
    expect(
      scanMarkers('.env.example', 'LUMO_MANAGED_SCAN', [marker])
    ).toHaveLength(1)
  })

  it('extractPathTokens finds file paths in npm scripts and hooks', () => {
    expect(
      extractPathTokens(
        '"lint:tokens": "tsx scripts/lint-tokens.ts", "x": "node ./cli/a.js && bash scripts/deploy/b.sh"'
      ).sort()
    ).toEqual(['cli/a.js', 'scripts/deploy/b.sh', 'scripts/lint-tokens.ts'])
    expect(extractPathTokens('npx tsx scripts/drift-check.ts "$1"')).toEqual([
      'scripts/drift-check.ts',
    ])
  })
})

describe('config-reference check (each config resolves against its own base)', () => {
  const snapshot = (
    contents: Record<string, string>,
    others: string[] = []
  ) => {
    const all = new Set([...Object.keys(contents), ...others])
    return {
      read: (p: string) => contents[p] ?? null,
      exists: (p: string) => all.has(p),
    }
  }
  const entry = (
    file: string,
    base: ConfigRefFile['base'],
    ignore?: string[]
  ): ConfigRefFile => ({
    file,
    base,
    reason: 'test',
    ...(ignore ? { ignore } : {}),
  })

  it('flags a token that only exists relative to the WRONG base', () => {
    // npm runs cli/package.json scripts inside cli/, so the script must be
    // cli/scripts/bundle-assets.js — a root scripts/bundle-assets.js does not
    // make the reference valid.
    const pkg = entry('cli/package.json', 'configDir')
    expect(
      findDanglingConfigRefs(
        [pkg],
        snapshot(
          {
            'cli/package.json':
              '{"scripts":{"build":"node ./scripts/bundle-assets.js"}}',
          },
          ['scripts/bundle-assets.js']
        )
      )
    ).toEqual([
      'cli/package.json → scripts/bundle-assets.js (resolved against cli/)',
    ])
    // git runs hooks from the repository root, so a hook's token must exist
    // at the root — a same-named file next to the hook does not count.
    const hook = entry('.husky/pre-commit', 'root')
    expect(
      findDanglingConfigRefs(
        [hook],
        snapshot(
          { '.husky/pre-commit': 'npx tsx scripts/drift-check.ts "$1"' },
          ['.husky/scripts/drift-check.ts']
        )
      )
    ).toEqual([
      '.husky/pre-commit → scripts/drift-check.ts (resolved against the snapshot root)',
    ])
  })

  it('accepts tokens that exist relative to the correct base', () => {
    expect(
      findDanglingConfigRefs(
        [
          entry('cli/package.json', 'configDir', ['dist/**']),
          entry('.husky/pre-commit', 'root'),
        ],
        snapshot(
          {
            'cli/package.json':
              '{"bin":{"lumo":"dist/cli/src/index.js"},"scripts":{"build":"tsc && node ./scripts/bundle-assets.js"}}',
            '.husky/pre-commit': 'npx tsx scripts/drift-check.ts "$1"',
          },
          ['cli/scripts/bundle-assets.js', 'scripts/drift-check.ts']
        )
      )
    ).toEqual([])
  })

  it('a token that climbs out of the snapshot is dangling', () => {
    expect(
      findDanglingConfigRefs(
        [entry('cli/tsconfig.json', 'configDir')],
        snapshot({
          'cli/tsconfig.json': '{"extends": "../../outside/base.json"}',
        })
      )
    ).toEqual([
      'cli/tsconfig.json → ../../outside/base.json (resolved against cli/)',
    ])
  })

  it('reports a configured file that is missing from the snapshot', () => {
    expect(
      findDanglingConfigRefs([entry('vercel.json', 'root')], snapshot({}))
    ).toEqual(['vercel.json (config file itself missing)'])
  })

  it('checks jest <rootDir> references that the token scan used to skip', () => {
    const jest =
      "setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], '^w$': '<rootDir>/__stubs__/workflow.ts'"
    expect(extractPathTokens(jest).sort()).toEqual([
      '__stubs__/workflow.ts',
      'jest.setup.js',
    ])
    expect(
      findDanglingConfigRefs(
        [entry('jest.config.js', 'configDir')],
        snapshot({ 'jest.config.js': jest }, ['jest.setup.js'])
      )
    ).toEqual([
      'jest.config.js → __stubs__/workflow.ts (resolved against the snapshot root)',
    ])
  })

  it('every config file in the snapshot must be listed — none is skipped', () => {
    expect(
      findUncoveredConfigFiles(
        [
          'package.json',
          'cli/package.json',
          'cli/tsconfig.json',
          'jest.config.js',
          '.husky/pre-commit',
          '.lintstagedrc.json',
          'vercel.json',
          'lib/a.ts',
          'lib/fixtures/data.json',
        ],
        [entry('package.json', 'root'), entry('vercel.json', 'root')]
      )
    ).toEqual([
      '.husky/pre-commit',
      '.lintstagedrc.json',
      'cli/package.json',
      'cli/tsconfig.json',
      'jest.config.js',
    ])
  })

  it('rejects entries that do not declare their resolution base', () => {
    expect(() => parseConfigRefFiles(['package.json'])).toThrow(/base/)
    expect(() =>
      parseConfigRefFiles([
        { file: 'package.json', base: 'either', reason: 'x' },
      ])
    ).toThrow(/base/)
    expect(() =>
      parseConfigRefFiles([{ file: 'package.json', base: 'root' }])
    ).toThrow(/reason/)
    expect(
      parseConfigRefFiles([{ file: 'package.json', base: 'root', reason: 'x' }])
    ).toEqual([{ file: 'package.json', base: 'root', reason: 'x' }])
  })
})

describe('isOutsideDir', () => {
  it('only a real `..` segment leaves the repository', () => {
    expect(isOutsideDir('/r/repo', '/r/snap')).toBe(true)
    expect(isOutsideDir('/r/repo', '/tmp/x')).toBe(true)
    expect(isOutsideDir('/r/repo', '/r/repo')).toBe(false)
    expect(isOutsideDir('/r/repo', '/r/repo/out')).toBe(false)
    // A directory INSIDE the repo whose name starts with two dots.
    expect(isOutsideDir('/r/repo', '/r/repo/..cache')).toBe(false)
  })
})

describe('oss/manifest.json', () => {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '../../oss/manifest.json'), 'utf8')
  ) as OssManifest

  it('every rule carries a reason and every marker compiles', () => {
    for (const r of [...manifest.include, ...manifest.exclude])
      expect({ glob: r.glob, hasReason: r.reason.length > 0 }).toEqual({
        glob: r.glob,
        hasReason: true,
      })
    for (const m of manifest.forbiddenMarkers ?? [])
      expect(() => new RegExp(m.pattern)).not.toThrow()
  })

  it('every configRefFiles entry declares its base and every config file of the repo is listed', () => {
    const entries = parseConfigRefFiles(manifest.configRefFiles ?? [])
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: join(__dirname, '../..'),
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
    const cls = classifyFiles(tracked, manifest)
    expect(findUncoveredConfigFiles(cls.included, entries)).toEqual([])
  })

  it('keeps the LUM-1033 D1 exclusions private and the lumo skill public', () => {
    const files = [
      '.agents/skills/x/SKILL.md',
      '.planning/ROADMAP.md',
      '.specify/memory/constitution.md',
      '.playwright-mcp/shot.png',
      'mcp.json',
      'AGENTS.md',
      '.claude/settings.json',
      'scripts/analysis/lum988/results.json',
      'scripts/eval/memory/vectors.fixture.json',
      'cli/skill/SKILL.md',
      'app/page.tsx',
    ]
    const cls = classifyFiles(files, manifest)
    expect(cls.unclassified).toEqual([])
    expect(cls.included).toEqual(['cli/skill/SKILL.md', 'app/page.tsx'])
  })

  it('the snapshot keeps exactly the crons whose route ships, in vercel.json and the crontab (LUM-1065)', () => {
    const root = join(__dirname, '../..')
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
    const shipped = new Set(classifyFiles(tracked, manifest).included)
    const transformed = (file: string) =>
      (manifest.transforms ?? [])
        .filter(t => t.file === file)
        .reduce(
          (src, t) => applyTransform(src, t),
          readFileSync(join(root, file), 'utf8')
        )
    const routeShips = (path: string) => shipped.has(`app${path}/route.ts`)
    const before = (
      JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
        crons: Array<{ path: string }>
      }
    ).crons.map(c => c.path)
    const after = (
      JSON.parse(transformed('vercel.json')) as {
        crons: Array<{ path: string }>
      }
    ).crons.map(c => c.path)
    // Every kept cron has its route; every dropped one is a route that stays
    // private — the filter neither leaves a 404 nor drops a core job.
    expect(after.filter(p => !routeShips(p))).toEqual([])
    expect(before.filter(p => !after.includes(p)).filter(routeShips)).toEqual(
      []
    )
    expect(before.length - after.length).toBe(5)
    // The crontab (generated from vercel.json) drops the same jobs.
    const jobPaths = (src: string) =>
      src
        .split('\n')
        .filter(l => /^[^#\s]/.test(l))
        .map(l => l.trim().split(/\s+/).pop()!)
    const crontab = jobPaths(transformed('deploy/self-host/crontab'))
    expect(crontab.filter(p => !routeShips(p))).toEqual([])
    expect(crontab.filter(p => before.includes(p))).toEqual(after)
  })

  it('the snapshot gets the plain MIT LICENSE; the private one scopes out the ee/ plugin (LUM-1066)', () => {
    const root = join(__dirname, '../..')
    const read = (p: string) => readFileSync(join(root, p), 'utf8')
    const mit = read('cli/LICENSE')
    // The ref's LICENSE stays private; the overlay supplies the snapshot's.
    const cls = classifyFiles(['LICENSE'], manifest)
    expect(cls.excluded).toEqual(['LICENSE'])
    expect(read('oss/overlay/LICENSE')).toBe(mit)
    // Private LICENSE = scope note + the same MIT text. The note names the
    // proprietary plugin and points at its license.
    const priv = read('LICENSE')
    expect(priv.endsWith(mit)).toBe(true)
    const note = priv.slice(0, priv.length - mit.length)
    expect(note.startsWith('Copyright (c) 2026 Lumo AI\n')).toBe(true)
    expect(note).toContain('NOT covered by the MIT License')
    expect(note).toContain('see ee/LICENSE')
    // ee/LICENSE is proprietary, not MIT, and never ships.
    const ee = read('ee/LICENSE')
    expect(ee).toContain('All rights reserved.')
    expect(ee).not.toContain('Permission is hereby granted')
    expect(classifyFiles(['ee/LICENSE'], manifest).included).toEqual([])
  })

  describe('public repository files and landing cleanup (LUM-1035)', () => {
    const root = join(__dirname, '../..')
    const read = (p: string) => readFileSync(join(root, p), 'utf8')
    const tracked = (paths: string[]) =>
      execFileSync('git', ['ls-files', '-z', '--', ...paths], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean)
    const LUM1035 = (manifest.transforms ?? []).filter(t =>
      t.reason.startsWith('LUM-1035')
    )
    const transformed = (file: string) =>
      (manifest.transforms ?? [])
        .filter(t => t.file === file)
        .reduce((src, t) => applyTransform(src, t), read(file))

    it('CONTRIBUTING, SECURITY and the DCO workflow ship from the overlay only', () => {
      for (const f of [
        'CONTRIBUTING.md',
        'SECURITY.md',
        '.github/workflows/dco.yml',
        '.github/scripts/check-dco.mjs',
      ])
        expect(read(`oss/overlay/${f}`).length).toBeGreaterThan(0)
      // The private repo runs no GitHub Actions and has no root copies.
      expect(tracked(['.github', 'CONTRIBUTING.md', 'SECURITY.md'])).toEqual([])
      expect(read('oss/overlay/CONTRIBUTING.md')).toContain('git commit -s')
      expect(read('oss/overlay/CONTRIBUTING.md')).toContain('Signed-off-by')
      expect(read('oss/overlay/.github/workflows/dco.yml')).toContain(
        'node .github/scripts/check-dco.mjs'
      )
    })

    it('the release runbook stays private', () => {
      const cls = classifyFiles(
        ['docs/open-source/release-and-sync.md'],
        manifest
      )
      expect(cls.excluded).toEqual(['docs/open-source/release-and-sync.md'])
    })

    it('every LUM-1035 transform still matches its source file', () => {
      expect(LUM1035.length).toBeGreaterThan(0)
      for (const t of LUM1035) {
        const src = read(t.file)
        expect({
          file: t.file,
          t,
          changes: applyTransform(src, t) !== src,
        }).toEqual({
          file: t.file,
          t,
          changes: true,
        })
      }
    })

    it('the snapshot landing page, FAQ and README carry no plugin copy; the private sources keep it', () => {
      const markers = manifest.forbiddenMarkers ?? []
      for (const f of [
        'components/landing/home/lumo-home.tsx',
        'components/landing/home/faq.tsx',
        'README.md',
      ])
        expect(scanMarkers(f, transformed(f), markers)).toEqual([])

      const home = transformed('components/landing/home/lumo-home.tsx')
      expect(home).not.toMatch(/PR SCAN|SECURITY|SCAN_FINDINGS|scan findings/)
      // The feature cards stay numbered 01–07 with no gap.
      const kickers = [...home.matchAll(/cellKicker\}>(\d\d) · /g)].map(
        m => m[1]
      )
      expect(kickers).toEqual(['01', '02', '03', '04', '05', '06', '07'])
      const faq = transformed('components/landing/home/faq.tsx')
      expect(faq).not.toMatch(/crossing triage|security scan|scan finds/i)
      expect(faq).toContain(
        'zero data retention enforced on the request itself.'
      )

      const readme = transformed('README.md')
      expect(readme.split('\n').slice(0, 4).join('\n')).toContain(
        '[Contributing](CONTRIBUTING.md)** · **[Security policy](SECURITY.md)'
      )
      expect(readme).toContain('See [CONTRIBUTING.md](CONTRIBUTING.md)')

      // Private repo keeps the hosted-service copy (ruling 2026-10-11 ④).
      expect(read('components/landing/home/lumo-home.tsx')).toContain(
        'SECURITY SCAN'
      )
      expect(read('components/landing/home/faq.tsx')).toContain(
        'for all but boundary-crossing triage'
      )
    })

    it('publish.sh is a dry run: it never pushes, tags remotely or calls GitHub', () => {
      const src = read('scripts/oss-export/publish.sh')
      // Drop heredoc bodies (the printed instructions) and comments.
      const executed = src
        .replace(/<<'?EOF'?[\s\S]*?\nEOF\n/g, '\n')
        .split('\n')
        .filter(l => !/^\s*#/.test(l))
        .join('\n')
      expect(executed).not.toMatch(
        /git(\s+-C\s+\S+)?\s+push|\bgh\s|curl|wget|git\s+tag|git\s+remote/
      )
      expect(src).toContain('git push -u origin main')
    })
  })

  describe('plugin copy scrub (LUM-1081)', () => {
    const root = join(__dirname, '../..')
    const read = (p: string) => readFileSync(join(root, p), 'utf8')
    const LUM1081 = (manifest.transforms ?? []).filter(t =>
      t.reason.startsWith('LUM-1081')
    )
    const locales = readdirSync(join(root, 'lib/i18n'))
      .filter(f => f.endsWith('.json'))
      .map(f => `lib/i18n/${f}`)
    const transformed = (file: string) =>
      (manifest.transforms ?? [])
        .filter(t => transformTargets(t, [file]).length > 0)
        .reduce((src, t) => applyTransform(src, t), read(file))
    const SURFACES = [
      'components/landing/home/how-it-works.tsx',
      'components/landing/home/lumo-terminal.tsx',
      'components/landing/home/compare.tsx',
      'app/layout.tsx',
      'components/security/SecurityPage.tsx',
      'app/workspace/[workspaceUrl]/components/pages/ApiKeysPage.tsx',
    ]
    /** Plugin features described in the snapshot's user-facing copy. */
    const PLUGIN_COPY =
      /lumo pr scan|scan the PR|[Ss]can findings|scanned before|scan every pull request|[Cc]rossing triage|boundary-crossing triage|TypeSafe|security scanning|run security scans|SARIF|working exploit|Findings hold the task/

    it('every LUM-1081 transform still matches its source file', () => {
      expect(LUM1081.length).toBeGreaterThan(0)
      for (const t of LUM1081) {
        const targets = transformTargets(t, [...SURFACES, ...locales])
        expect({ t, targets: targets.length > 0 }).toEqual({ t, targets: true })
        const changes = targets.some(
          f => applyTransform(read(f), t) !== read(f)
        )
        expect({ t, changes }).toEqual({ t, changes: true })
      }
    })

    it('the snapshot copy carries no plugin feature description; markers stay clean', () => {
      const markers = manifest.forbiddenMarkers ?? []
      for (const f of [...SURFACES, ...locales]) {
        const out = transformed(f)
        expect({ f, hits: scanMarkers(f, out, markers) }).toEqual({
          f,
          hits: [],
        })
        if (!f.endsWith('.json'))
          expect({ f, plugin: PLUGIN_COPY.exec(out)?.[0] ?? null }).toEqual({
            f,
            plugin: null,
          })
      }
      const en = JSON.parse(transformed('lib/i18n/en.json')) as Record<
        string,
        string
      >
      const described = Object.entries(en).filter(
        ([k, v]) =>
          /^(security|github|workspaceSettings|apiKeys|dataRetention)\./.test(
            k
          ) && PLUGIN_COPY.test(v)
      )
      expect(described).toEqual([])
      expect(en['security.code.ai']).toMatch(/^To write summaries/)
      expect(en['github.description']).toBe(
        "Pull requests and checks for this workspace's repositories."
      )
      expect(Object.keys(en).some(k => k.startsWith('oss.'))).toBe(false)
      expect(
        Object.keys(en).some(k =>
          k.startsWith('workspaceSettings.securityScan.')
        )
      ).toBe(false)
    })

    it('every locale stays in parity after the transform', () => {
      const keys = (f: string) =>
        Object.keys(JSON.parse(transformed(f)) as object).sort()
      const enKeys = keys('lib/i18n/en.json')
      for (const f of locales)
        expect({ f, same: keys(f).join() === enKeys.join() }).toEqual({
          f,
          same: true,
        })
    })

    it('the snapshot /security page drops the plugin paragraphs only', () => {
      const page = transformed('components/security/SecurityPage.tsx')
      expect(page).toContain(
        "paragraphs: ['hosting', 'transit', 'atRest', 'tokens'],"
      )
      for (const p of [
        'training',
        'hookEvents',
        'crossing',
        'deadLetter',
        'derived',
      ])
        expect(page).toContain(`'${p}'`)
      expect(page).not.toMatch(/'sandbox'|'triage'|'uninstall'/)
    })

    it('every oss.* variant has its hosted key in every locale (private repo)', () => {
      for (const f of locales) {
        const d = JSON.parse(read(f)) as Record<string, string>
        const variants = Object.keys(d).filter(k => k.startsWith('oss.'))
        expect(variants.length).toBe(9)
        for (const v of variants) {
          expect({ f, v, base: v.slice(4) in d }).toEqual({ f, v, base: true })
          expect(d[v]).not.toBe(d[v.slice(4)])
          expect(d[v]).not.toMatch(/\[TODO:/)
        }
      }
    })

    it('the private sources keep the hosted copy', () => {
      expect(read('components/landing/home/lumo-terminal.tsx')).toContain(
        "cmd: 'lumo pr show 482'"
      )
      expect(read('components/landing/home/how-it-works.tsx')).toContain(
        'Every pull request is scanned.'
      )
      expect(read('components/landing/home/compare.tsx')).toContain(
        'An agent that hunts for a working exploit'
      )
      expect(read('app/layout.tsx')).toContain('scan every pull request')
      expect(read('components/security/SecurityPage.tsx')).toContain("'triage'")
      const en = JSON.parse(read('lib/i18n/en.json')) as Record<string, string>
      expect(en['security.code.triage']).toMatch(/^Boundary-crossing triage/)
      expect(en['github.description']).toContain('security scanning')
    })

    it('support and security addresses are on uselumo.ai', () => {
      expect(read('README.md')).toContain('support@uselumo.ai')
      expect(read('README.md')).not.toMatch(/@lumo\.ai\b/)
      expect(read('oss/overlay/SECURITY.md')).toContain('security@uselumo.ai')
    })
  })

  it('the private manifest itself never ships', () => {
    const cls = classifyFiles(
      [
        'oss/manifest.json',
        'scripts/oss-export.ts',
        'scripts/oss-export/manifest.ts',
      ],
      manifest
    )
    expect(cls.included).toEqual([])
  })
})

// LUM-1064: test-utils/ee/plugin-boundary.ts re-implements the export's import
// and glob rules (it ships with the tests and so cannot import this private
// module). The boundary guards are only as good as that copy — pin it to the
// export on every tracked file of the repository.
describe('plugin-boundary guard rules match the export (LUM-1064)', () => {
  const root = join(__dirname, '../..')
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\0')
    .filter(Boolean)
  const files = new Set(tracked)

  it('shippedFiles() is classifyFiles().included on the real manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'oss/manifest.json'), 'utf8')
    ) as OssManifest
    expect(boundary.shippedFiles(tracked, manifest)).toEqual(
      classifyFiles(tracked, manifest).included
    )
    for (const r of [...manifest.include, ...manifest.exclude])
      expect(boundary.globToRegExp(r.glob).source).toBe(
        globToRegExp(r.glob).source
      )
  })

  it('extracts and resolves the same import targets on every tracked code file', () => {
    let compared = 0
    for (const f of tracked) {
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(f)) continue
      let src: string
      try {
        src = readFileSync(join(root, f), 'utf8')
      } catch {
        continue
      }
      const specs = extractSpecifiers(src)
      expect(boundary.extractSpecifiers(src)).toEqual(specs)
      for (const s of specs) {
        // The guard additionally resolves `@lumo/shared` (as the RFC script
        // does), which the export treats as a package.
        if (s === '@lumo/shared' || s.startsWith('@lumo/shared/')) continue
        if (
          boundary.resolveSpecifier(f, s, files) !==
          resolveSpecifier(f, s, files)
        )
          throw new Error(`resolution differs: ${f} → ${s}`)
      }
      compared++
    }
    expect(compared).toBeGreaterThan(4000)
  })
})
