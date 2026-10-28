/**
 * @jest-environment node
 *
 * LUM-1318 — the scan / review layer talks to a repository only through the
 * `GitProvider` port (`lib/integrations/git-provider`); it never imports the
 * GitHub client (`lib/integrations/github`) itself. A second platform is
 * then added by writing an adapter, not by touching the scan.
 *
 * Scope is a RULE, not a list: every non-test module of the security plugin
 * (`ee/security/**` — PR scan, AI review, hunt, managed scan, verifier,
 * comment / thread / verdict / description write-back, PR commands and chat)
 * and the workflows that run its jobs (`lib/workflows/security-*`,
 * `lib/workflows/review-verifier*`). Any import form counts: static, type
 * only, re-export, dynamic `import()`, `require`, relative paths.
 *
 * GitHub-native plumbing (App install, webhooks, comment mirror, PR sync)
 * lives outside this scope. A module inside it that must stay on GitHub
 * directly goes on `GITHUB_NATIVE_ALLOWLIST` with its reason — none today.
 */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'

// Overridable only to show the guard red against an older tree (evidence).
const ROOT =
  process.env.LUMO_SCAN_GUARD_ROOT ?? path.resolve(__dirname, '../../../..')

const SCOPE_DIRS = ['ee/security']
const SCOPE_FILES =
  /^lib\/workflows\/(security-[^/]+|review-verifier[^/]*)\.tsx?$/

/** file → why it may import the GitHub client directly. */
const GITHUB_NATIVE_ALLOWLIST: Readonly<Record<string, string>> = {}

const GITHUB_CLIENT_DIR = 'lib/integrations/github'

/** Does `specifier`, imported from `fromFile` (repo-relative), reach the GitHub client? */
function reachesGithubClient(specifier: string, fromFile: string): boolean {
  const raw = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(fromFile), specifier)
      : specifier
  const target = path.posix.normalize(raw).replace(/\/+$/, '')
  return (
    target === GITHUB_CLIENT_DIR || target.startsWith(`${GITHUB_CLIENT_DIR}/`)
  )
}

/** Every module specifier `source` loads, whatever the form. */
function moduleSpecifiers(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      out.push(node.moduleSpecifier.text)
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      out.push(node.moduleReference.expression.text)
    else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const arg = node.arguments[0]!
      const literal =
        ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
      const isLoad =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          /^require(Actual|Mock)?$/.test(node.expression.name.text))
      if (literal && isLoad) out.push(arg.text)
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal))
        out.push(arg.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** The GitHub-client imports of one file (repo-relative path). */
/**
 * LUM-1318 follow-up — GitHub-specific strings the scan must get from the
 * port instead of spelling them: web / clone URLs (`github.com`), the clone
 * token's basic-auth username, and the GitHub webhook's event names (the
 * scan listens on the provider-neutral `git.*` names).
 */
const GITHUB_STRING = /github\.com|x-access-token/i
const GITHUB_EVENT_NAMES = new Set([
  'github.pullRequest',
  'github.push',
  'github.reviewThread',
  'github.issueComment',
  'github.reviewComment',
])

/** file → why it may spell a GitHub string literally. */
const GITHUB_STRING_ALLOWLIST: Readonly<Record<string, string>> = {
  'ee/security/security-scan/semgrep-rules.ts':
    "Lumo's own rule pack metadata: each rule's `source` points at Lumo's public rule file, not at the scanned repository or PR",
  'ee/security/services/security-managed-scan.config.ts':
    'pinned release downloads of the scanner binaries (gitleaks, osv-scanner, zizmor, trivy) — where the tools are published, whatever platform the scanned PR is on',
}

/** Every string / template text in `source` (comments are not strings). */
function stringTexts(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      out.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** The GitHub-specific strings one file spells (URLs, clone username, event names). */
function githubStringsOf(file: string, source: string): string[] {
  return stringTexts(file, source).filter(
    text => GITHUB_STRING.test(text) || GITHUB_EVENT_NAMES.has(text)
  )
}

function githubImportsOf(file: string, source: string): string[] {
  return moduleSpecifiers(file, source).filter(s =>
    reachesGithubClient(s, file)
  )
}

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      out.push(...walk(rel))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(rel)
  }
  return out
}

/** The modules in the scan / review scope, by the rule above. */
function scanScopeFiles(): string[] {
  const workflows = fs
    .readdirSync(path.join(ROOT, 'lib/workflows'))
    .map(name => `lib/workflows/${name}`)
    .filter(file => SCOPE_FILES.test(file))
  return [...SCOPE_DIRS.flatMap(walk), ...workflows].sort()
}

describe('scan / review scope never imports the GitHub client (LUM-1318)', () => {
  it('the scope rule covers the scan and review entry points', () => {
    const files = scanScopeFiles()
    for (const entry of [
      'ee/security/services/pr-security-scan.service.ts',
      'ee/security/services/security-pr-review.service.ts',
      'ee/security/services/auto-review-admission.service.ts',
      'ee/security/services/security-hunt.service.ts',
      'ee/security/services/security-managed-scan.service.ts',
      'ee/security/services/pr-finding-thread.service.ts',
      'ee/security/services/pr-review-verdict.service.ts',
      'ee/security/services/pr-description-summary.service.ts',
      'ee/security/services/issue-assessment-review.service.ts',
      'lib/workflows/security-hunt.ts',
      'lib/workflows/security-managed-scan.ts',
      'lib/workflows/review-verifier.ts',
    ])
      expect(files).toContain(entry)
  })

  it('no module in scope imports lib/integrations/github', () => {
    const offenders: string[] = []
    for (const file of scanScopeFiles()) {
      if (file in GITHUB_NATIVE_ALLOWLIST) continue
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      for (const spec of githubImportsOf(file, source))
        offenders.push(`${file} → ${spec}`)
    }
    expect(offenders).toEqual([])
  })

  it('every allowlisted file still exists and still needs it', () => {
    for (const [file, reason] of Object.entries(GITHUB_NATIVE_ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(0)
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(githubImportsOf(file, source).length).toBeGreaterThan(0)
    }
  })
})

describe('scan / review scope spells no GitHub URL, clone username or event name (LUM-1318)', () => {
  it('no module in scope builds a github.com URL, names x-access-token or listens on github.*', () => {
    const offenders: string[] = []
    for (const file of scanScopeFiles()) {
      if (file in GITHUB_STRING_ALLOWLIST) continue
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      for (const text of githubStringsOf(file, source))
        offenders.push(`${file} → ${JSON.stringify(text.slice(0, 80))}`)
    }
    expect(offenders).toEqual([])
  })

  it('every allowlisted file still exists and still needs it', () => {
    for (const [file, reason] of Object.entries(GITHUB_STRING_ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(0)
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(githubStringsOf(file, source).length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['a commit link', 'const u = `https://github.com/${repo}/commit/${sha}`'],
    ['a clone URL', "const u = 'https://github.com/' + repo + '.git'"],
    ['the clone username', "const user = 'x-access-token'"],
    ['a GitHub event name', "api.on('github.issueComment', handler)"],
    ['an event type key', "type E = CoreEvents['github.reviewComment']"],
  ])('flags %s', (_label, source) => {
    expect(githubStringsOf('ee/security/x.ts', source)).toHaveLength(1)
  })

  it.each([
    ['a comment', '// see https://github.com/o/r'],
    ['the neutral event', "api.on('git.issueComment', handler)"],
    ['a github i18n key', "intl.formatMessage({ id: 'github.title' })"],
  ])('does not flag %s', (_label, source) => {
    expect(githubStringsOf('ee/security/x.ts', source)).toEqual([])
  })
})

describe('the import audit itself', () => {
  const file = 'ee/security/services/example.service.ts'
  it.each([
    [
      'static',
      "import { fetchPrDiff } from '@/lib/integrations/github/contents'",
    ],
    [
      'type only',
      "import type { ListedReview } from '@/lib/integrations/github/pr-comment-client'",
    ],
    ['barrel', "import { getRepoToken } from '@/lib/integrations/github'"],
    [
      're-export',
      "export { TarReader } from '@/lib/integrations/github/tar-reader'",
    ],
    [
      'dynamic',
      "async function f() { return import('@/lib/integrations/github/contents') }",
    ],
    ['require', "const m = require('@/lib/integrations/github/auth')"],
    [
      'relative',
      "import { x } from '../../../lib/integrations/github/contents'",
    ],
    [
      'import type node',
      "type T = typeof import('@/lib/integrations/github/contents')",
    ],
  ])('flags a %s import', (_label, source) => {
    expect(githubImportsOf(file, source)).toHaveLength(1)
  })

  it.each([
    [
      'the port',
      "import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'",
    ],
    [
      'a look-alike path',
      "import { x } from '@/lib/integrations/github-app-like'",
    ],
    [
      'a string that is not a load',
      "const s = '@/lib/integrations/github/contents'",
    ],
  ])('does not flag %s', (_label, source) => {
    expect(githubImportsOf(file, source)).toEqual([])
  })
})
