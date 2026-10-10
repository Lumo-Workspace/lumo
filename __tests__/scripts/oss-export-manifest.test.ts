/** @jest-environment node */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  applyTransform,
  classifyFiles,
  extractPathTokens,
  extractSpecifiers,
  findDanglingConfigRefs,
  findImportViolations,
  findUncoveredConfigFiles,
  parseConfigRefFiles,
  globToRegExp,
  isOutsideDir,
  matchesGlob,
  resolveSpecifier,
  scanMarkers,
  summarizePaths,
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
    // .claude/skills/* are symlinks into .agents/; .claude/skills/lumo/** is public.
    expect(matchesGlob('.claude/skills/clerk', '.claude/skills/*')).toBe(true)
    expect(
      matchesGlob('.claude/skills/lumo/SKILL.md', '.claude/skills/*')
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

describe('transforms', () => {
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
      '.claude/skills/lumo/SKILL.md',
      'app/page.tsx',
    ]
    const cls = classifyFiles(files, manifest)
    expect(cls.unclassified).toEqual([])
    expect(cls.included).toEqual([
      '.claude/skills/lumo/SKILL.md',
      'app/page.tsx',
    ])
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
