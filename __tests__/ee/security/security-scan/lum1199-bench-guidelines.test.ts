/**
 * LUM-1199 — a benchmark repository's own guidelines as LUM-1147 path
 * instructions (deterministic extraction), and the replay's per-PR input
 * through the production rendering. Here, not under the bench's own
 * __tests__: it imports plugin code, so it sits under the plugin test root.
 */
import {
  buildRepoPathInstructions,
  classifyGuidelineFile,
  packRules,
  reviewConfigInstructions,
  ruleLines,
} from '@/scripts/analysis/lum1158-review-quality-bench/guidelines-lib'
import {
  instructionsForPr,
  replayPathInstructions,
} from '@/scripts/analysis/lum1158-review-quality-bench/path-instructions-input'
import {
  PATH_INSTRUCTION_MAX_CHARS,
  PATH_INSTRUCTIONS_MAX_ENTRIES,
  REVIEW_PATH_INSTRUCTIONS_MAX_CHARS,
} from '@/ee/security/security-scan/path-instructions'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'

describe('classifyGuidelineFile', () => {
  it.each([
    ['AGENTS.md', 'agent', '**'],
    ['CLAUDE.md', 'agent', '**'],
    ['.claude/CLAUDE.md', 'agent', '**'],
    ['.github/copilot-instructions.md', 'agent', '**'],
    ['.cursorrules', 'agent', '**'],
    ['CONTRIBUTING.md', 'contributing', '**'],
    ['.github/CONTRIBUTING.md', 'contributing', '**'],
    ['docs/contributing.md', 'contributing', '**'],
    ['REVIEW.md', 'review-doc', '**'],
    ['.github/REVIEW.md', 'review-doc', '**'],
    ['REVIEW_GUIDE.md', 'review-doc', '**'],
    ['packages/ui/AGENTS.md', 'scoped-doc', 'packages/ui/**'],
    ['rust/CLAUDE.md', 'scoped-doc', 'rust/**'],
    ['action/CONTRIBUTING.md', 'scoped-doc', 'action/**'],
    ['.cursor/rules/testing.mdc', 'scoped-rule', null],
    ['.github/instructions/api.instructions.md', 'scoped-rule', null],
    ['.lumo.yaml', 'review-config', null],
    ['.some-reviewer.yaml', 'review-config', null],
  ])('%s → %s %s', (p, kind, scope) => {
    expect(classifyGuidelineFile(p)).toEqual({ kind, scope })
  })

  it.each([
    'README.md',
    'docs/guide.md',
    'tests/fixtures/x/AGENTS.md',
    'packages/nx/files/AGENTS.md',
    'template/CLAUDE.md',
    'internal/assets/gga/AGENTS.md',
    '.repos/vendored/AGENTS.md',
    'docs/content/fr/contributing.md',
    'config/.reviewer.yaml',
    'CODE_OF_CONDUCT.md',
  ])('ignores %s', p => {
    expect(classifyGuidelineFile(p)).toBeNull()
  })
})

describe('ruleLines / packRules', () => {
  const md = [
    '---',
    'description: x',
    '---',
    '# Project',
    'Some intro about the project that is long enough to count.',
    '## Build Commands',
    '- Always run `make build` before you commit anything here.',
    '```bash',
    'npm test # Never shown: inside a fence',
    '```',
    '## Conventions',
    '- Adapters **must** stay thin; business logic lives in [services](docs/s.md).',
    '',
    'These files are generated and must not be edited:',
    '- Prefer named exports over default exports in every module.',
    '  continued on the next line.',
    '| table | row that should not appear |',
    '<!-- hidden comment that must not appear -->',
    '- ok',
  ].join('\n')

  it('keeps rule-like blocks, drops fences, tables, comments and setup sections', () => {
    const lines = ruleLines(md)
    expect(lines.map(l => l.text)).toEqual([
      'Some intro about the project that is long enough to count.',
      'Adapters must stay thin; business logic lives in services.',
      'Prefer named exports over default exports in every module. continued on the next line.',
    ])
    // Directive list items outrank plain prose.
    expect(lines[1]!.score).toBeGreaterThan(lines[0]!.score)
  })

  it('packs the best lines within the cap, in document order', () => {
    const lines = ruleLines(md)
    const all = packRules(lines)
    expect(all.startsWith('Some intro')).toBe(true)
    const tight = packRules(lines, 100)
    expect(tight.length).toBeLessThanOrEqual(100)
    expect(tight).toContain('Adapters must stay thin')
    expect(tight).not.toContain('Some intro')
  })
})

describe('reviewConfigInstructions', () => {
  it('reads reviews.path_instructions in the .lumo.yaml shape', () => {
    const yaml = [
      'reviews:',
      '  path_instructions:',
      '    - path: "src/**/*.ts"',
      '      instructions: |',
      '        Check error handling.',
      '        Keep adapters thin.',
      '    - path: 7',
      '      instructions: bad',
    ].join('\n')
    expect(reviewConfigInstructions(yaml)).toEqual([
      {
        path: 'src/**/*.ts',
        instructions: 'Check error handling.\nKeep adapters thin.',
      },
    ])
  })

  it('returns [] for a file without the key or that does not parse', () => {
    expect(reviewConfigInstructions('reviews:\n  profile: chill\n')).toEqual([])
    expect(reviewConfigInstructions(': : :\n\t- [')).toEqual([])
  })
})

describe('buildRepoPathInstructions', () => {
  const rule = (s: string) => `- You must ${s} in this part of the code.`
  it('orders review config, the whole-repo entry, glob-scoped rules, then nested docs by depth', () => {
    const out = buildRepoPathInstructions([
      { path: 'packages/b/AGENTS.md', text: rule('b') },
      { path: 'AGENTS.md', text: rule('agents') },
      { path: 'REVIEW.md', text: rule('review') },
      { path: 'CONTRIBUTING.md', text: rule('contrib') },
      { path: 'a/AGENTS.md', text: rule('a') },
      {
        path: '.cursor/rules/t.mdc',
        text: `---\nglobs: "**/*.test.ts, e2e/**"\n---\n${rule('test')}`,
      },
      {
        path: '.cursor/rules/off.mdc',
        text: `---\nalwaysApply: false\n---\n${rule('off')}`,
      },
      {
        path: '.github/instructions/x.instructions.md',
        text: `---\napplyTo: "api/**"\n---\n${rule('api')}`,
      },
      {
        path: '.lumo.yaml',
        text: 'reviews:\n  path_instructions:\n    - path: "src/**"\n      instructions: Check locks.\n',
      },
    ])
    expect(out.instructions.map(i => i.path)).toEqual([
      'src/**',
      '**',
      '**/*.test.ts',
      'e2e/**',
      'api/**',
      'a/**',
      'packages/b/**',
    ])
    const whole = out.instructions[1]!.instructions
    // The review doc's rules come first, then agent docs, then CONTRIBUTING.
    expect(whole.indexOf('review')).toBeLessThan(whole.indexOf('agents'))
    expect(whole.indexOf('agents')).toBeLessThan(whole.indexOf('contrib'))
    expect(out.sources.find(s => s.path === '.cursor/rules/off.mdc')).toEqual(
      expect.objectContaining({ entries: 0 })
    )
    expect(out.dropped).toBe(0)
  })

  it('collapses identical copies and caps entries and characters', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      path: `p${String(i).padStart(2, '0')}/AGENTS.md`,
      text: rule(`x${i}`),
    }))
    const long = Array.from({ length: 80 }, (_, i) => rule(`r${i}`)).join('\n')
    const out = buildRepoPathInstructions([
      { path: 'AGENTS.md', text: long },
      { path: 'CLAUDE.md', text: long },
      ...many,
    ])
    expect(out.instructions).toHaveLength(PATH_INSTRUCTIONS_MAX_ENTRIES)
    expect(out.dropped).toBe(31 - PATH_INSTRUCTIONS_MAX_ENTRIES)
    const whole = out.instructions[0]!.instructions
    expect(whole.length).toBeLessThanOrEqual(PATH_INSTRUCTION_MAX_CHARS)
    expect(whole.match(/You must r0 /g)).toHaveLength(1)
  })

  it('gives a repo without guidelines no instructions', () => {
    const out = buildRepoPathInstructions([
      { path: 'AGENTS.md', text: '# Title\n' },
      { path: '.golangci.yml', text: 'linters:\n  enable: [vet]\n' },
    ])
    expect(out.instructions).toEqual([])
    // A root YAML without `reviews.path_instructions` is not a source.
    expect(out.sources.map(s => s.path)).toEqual(['AGENTS.md'])
  })
})

describe('replay input (production rendering)', () => {
  const url = 'https://github.com/acme/widget/pull/7'
  it('looks a PR up by url and accepts only a list', () => {
    expect(
      instructionsForPr({ [url]: [{ path: '**', instructions: 'x' }] }, url)
    ).toEqual([{ path: '**', instructions: 'x' }])
    expect(instructionsForPr({}, url)).toEqual([])
    expect(instructionsForPr({ [url]: 'nope' }, url)).toEqual([])
  })

  it('renders only entries matching reviewed files, guarded and capped', () => {
    const list = [
      { path: 'docs/**', instructions: 'Docs only.' },
      { path: 'src/**', instructions: 'Keep\nadapters thin.' },
      ...Array.from({ length: 10 }, (_, i) => ({
        path: `src/x${i}/**`,
        instructions: 'y'.repeat(900),
      })),
      { path: 'src/*.ts', instructions: 'z'.repeat(900) },
    ]
    const out = replayPathInstructions(list, ['src/a.ts'])
    expect(out.text.split('\n')[0]).toBe(
      `- [${guardPromptLineText('src/**')}] ${guardPromptLineText('Keep adapters thin.')}`
    )
    expect(out.sent.map(s => s.path)).toEqual(['src/**', 'src/*.ts'])
    expect(out.text.length).toBeLessThanOrEqual(
      REVIEW_PATH_INSTRUCTIONS_MAX_CHARS
    )
    expect(replayPathInstructions(list, ['lib/a.ts']).text).toBe('')
    expect(replayPathInstructions('junk', ['src/a.ts']).text).toBe('')
  })
})
