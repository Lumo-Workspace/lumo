/**
 * @jest-environment node
 *
 * LUM-977 — every `app/api/**\/route.ts` that exports an HTTP handler must
 * authenticate the caller. Tenant isolation in Lumo is app-layer only (no
 * Postgres RLS), so a route that forgets its guard is a cross-tenant hole.
 * This test turns CI red when a new route ships without one.
 *
 * A route is accepted in exactly one of three ways:
 *  - guarded      — calls an AUTHENTICATION guard imported from its home
 *                   module (`AUTH_GUARDS`). Membership helpers such as
 *                   `requireWorkspaceMember` / `loadProjectAndMember` /
 *                   `getUserWorkspace` take a clerkId argument and do not
 *                   authenticate on their own, so they do not count.
 *  - delegated    — calls a shared handler that authenticates
 *                   (`AUTH_DELEGATES`), or is listed in `PER_FILE_AUTH` with
 *                   the call that carries its bespoke mechanism (signed
 *                   OAuth state, webhook HMAC) and a reason.
 *  - allow-listed — listed in `ALLOW_LISTED` with a one-line reason.
 *
 * Matching uses the TypeScript AST: only real call expressions count, so a
 * guard name in a comment or string literal does not satisfy the check, and
 * the callee must resolve to an import from the expected module (a local
 * function that happens to be called `requireAuth` does not count).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, posix, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(__dirname, '..')
const API_DIR = join(ROOT, 'app', 'api')

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])

// `<module>#<callee>`; module is repo-relative without extension (or a bare
// package name), callee is `name` or `importedObject.method`.
const AUTH_GUARDS = new Set([
  'lib/auth#requireIdentity',
  'lib/auth/identity#requireIdentity',
  'lib/auth#requireAuth',
  'lib/auth#verifyBearer',
  'lib/auth/bearer#verifyBearer',
  'lib/api/cron-auth#requireCronAuth',
  'ee/security/auth/sarif-ingest-auth#authenticateSarifIngest',
  'lib/integrations/github#verifyGitHubSignature',
  'lib/integrations/github/verify#verifyGitHubSignature',
  // LUM-906: Clerk webhook — Svix signature via Clerk's verifyWebhook.
  'lib/auth/clerk-webhook#verifyClerkWebhook',
  'lib/services/auth.service#authService.verifyApiKey',
  // app/api/mcp: passed to `withMcpAuth(..., { required: true })`.
  // LUM-1026: the @/lib/auth wrapper around Clerk's verifyClerkToken.
  'lib/auth/mcp#verifyMcpAccessToken',
])

const AUTH_DELEGATES = new Set([
  // Verifies the bearer API key before anything else (401 otherwise).
  'app/api/hooks/_handler#handleHookRequest',
])

// Routes whose authentication is bespoke but verified by reading the code.
// `call` must still be present, so the entry fails if the mechanism goes.
const PER_FILE_AUTH: Record<string, { call: string; reason: string }> = {
  'app/api/auth/[...all]/route.ts': {
    call: 'lib/auth/handler#handleAuthRequest',
    reason:
      'Better Auth API (LUM-1027): the sign-in/sign-up/session endpoints themselves — Better Auth checks credentials, session cookies and OAuth state per endpoint; 404 unless AUTH_PROVIDER=better-auth',
  },
  'app/api/webhooks/sentry/route.ts': {
    call: 'lib/services/sentry.service#sentryService.handleWebhook',
    reason:
      'Sentry webhook: handleWebhook verifies the sentry-hook-signature HMAC with the stored client secret before acting (401 otherwise)',
  },
  'app/api/webhooks/slack/route.ts': {
    call: 'local#verifySlackSignature',
    reason:
      'Slack webhook: in-file verifySlackSignature checks the v0 HMAC with SLACK_SIGNING_SECRET and a 5-minute replay window',
  },
}

const ALLOW_LISTED: Record<string, string> = {
  'app/api/waitlist/route.ts':
    'Intentionally public: marketing-site waitlist signup, writes only a WaitlistEntry',
  'app/api/blob/public/[...path]/route.ts':
    'Intentionally public (LUM-1021): serves workspace logos on S3/disk storage; reads only the public namespace and logo-shaped paths',
}

type RouteScan = {
  /** HTTP methods the file exports. Empty → not a handler file. */
  methods: string[]
  /** Every resolved callee as `<module>#<callee>`. */
  calls: Set<string>
}

function resolveModule(fromFile: string, specifier: string): string {
  let mod = specifier
  if (specifier.startsWith('@/')) mod = specifier.slice(2)
  else if (specifier.startsWith('.'))
    mod = posix.join(posix.dirname(fromFile), specifier)
  return mod.replace(/\.(ts|tsx|js|jsx)$/, '').replace(/\/index$/, '')
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      m => m.kind === ts.SyntaxKind.ExportKeyword
    )
  )
}

/** Parses one route file; `relPath` is repo-relative with `/` separators. */
function scanRouteSource(relPath: string, source: string): RouteScan {
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true)
  const imports = new Map<string, string>() // local name → `<module>#<name>`
  const locals = new Set<string>()
  const methods = new Set<string>()

  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const mod = resolveModule(relPath, stmt.moduleSpecifier.text)
      const clause = stmt.importClause
      if (clause?.name) imports.set(clause.name.text, `${mod}#default`)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text
          imports.set(el.name.text, `${mod}#${imported}`)
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      locals.add(stmt.name.text)
      if (hasExportModifier(stmt) && HTTP_METHODS.has(stmt.name.text))
        methods.add(stmt.name.text)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        locals.add(decl.name.text)
        if (hasExportModifier(stmt) && HTTP_METHODS.has(decl.name.text))
          methods.add(decl.name.text)
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        if (HTTP_METHODS.has(el.name.text)) methods.add(el.name.text)
      }
    }
  }

  const resolve = (name: string): string =>
    imports.get(name) ??
    (locals.has(name) ? `local#${name}` : `unknown#${name}`)

  const calls = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee)) {
        calls.add(resolve(callee.text))
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression)
      ) {
        calls.add(`${resolve(callee.expression.text)}.${callee.name.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return { methods: [...methods].sort(), calls }
}

function callsAny(scan: RouteScan, allowed: Set<string>): boolean {
  return [...scan.calls].some(c => allowed.has(c))
}

function listRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listRouteFiles(full))
    else if (/^route\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const toRel = (full: string): string =>
  relative(ROOT, full).split('\\').join('/')

const routes = listRouteFiles(API_DIR)
  .map(full => {
    const rel = toRel(full)
    return { rel, scan: scanRouteSource(rel, readFileSync(full, 'utf8')) }
  })
  .filter(r => r.scan.methods.length > 0)
  .sort((a, b) => a.rel.localeCompare(b.rel))

const guarded = routes.filter(r => callsAny(r.scan, AUTH_GUARDS))
const delegated = routes.filter(
  r =>
    !callsAny(r.scan, AUTH_GUARDS) &&
    (callsAny(r.scan, AUTH_DELEGATES) ||
      (PER_FILE_AUTH[r.rel] !== undefined &&
        r.scan.calls.has(PER_FILE_AUTH[r.rel]!.call)))
)
const accepted = new Set([...guarded, ...delegated].map(r => r.rel))
const allowListed = routes.filter(
  r => !accepted.has(r.rel) && ALLOW_LISTED[r.rel] !== undefined
)
const unguarded = routes.filter(
  r => !accepted.has(r.rel) && ALLOW_LISTED[r.rel] === undefined
)

describe('LUM-977: every API route calls an auth guard', () => {
  it(`classifies ${routes.length} handler routes: ${guarded.length} guarded / ${delegated.length} delegated / ${allowListed.length} allow-listed / ${unguarded.length} unguarded`, () => {
    // Sanity: the walk found the tree (295 route files at LUM-977).
    expect(routes.length).toBeGreaterThan(200)
    const offenders = unguarded.map(
      r =>
        `${r.rel} (exports ${r.scan.methods.join(', ')}) calls no recognized auth guard — ` +
        'add requireIdentity/requireAuth/verifyBearer/requireCronAuth, or allow-list it with a reason in __tests__/api-route-auth-guard-coverage.test.ts'
    )
    expect(offenders).toEqual([])
  })

  it('every PER_FILE_AUTH entry exists, still calls its mechanism, and has a one-line reason', () => {
    const problems: string[] = []
    for (const [rel, { call, reason }] of Object.entries(PER_FILE_AUTH)) {
      const route = routes.find(r => r.rel === rel)
      if (!existsSync(join(ROOT, rel)) || !route) {
        problems.push(`${rel}: no such handler route — remove the entry`)
        continue
      }
      if (!route.scan.calls.has(call))
        problems.push(`${rel}: no longer calls ${call} — re-verify its auth`)
      if (callsAny(route.scan, AUTH_GUARDS))
        problems.push(`${rel}: now calls a recognized guard — remove the entry`)
      if (!reason.trim() || reason.includes('\n'))
        problems.push(`${rel}: reason must be a non-empty single line`)
    }
    expect(problems).toEqual([])
  })

  it('every ALLOW_LISTED entry exists, is still needed, and has a one-line reason', () => {
    const problems: string[] = []
    for (const [rel, reason] of Object.entries(ALLOW_LISTED)) {
      const route = routes.find(r => r.rel === rel)
      if (!existsSync(join(ROOT, rel)) || !route) {
        problems.push(`${rel}: no such handler route — remove the entry`)
        continue
      }
      if (accepted.has(rel))
        problems.push(`${rel}: now guarded or delegated — remove the entry`)
      if (PER_FILE_AUTH[rel] !== undefined)
        problems.push(`${rel}: listed in both PER_FILE_AUTH and ALLOW_LISTED`)
      if (!reason.trim() || reason.includes('\n'))
        problems.push(`${rel}: reason must be a non-empty single line`)
    }
    expect(problems).toEqual([])
  })
})

describe('scanRouteSource', () => {
  const FILE = 'app/api/example/route.ts'

  it('ignores guard names that appear only in comments and strings', () => {
    const scan = scanRouteSource(
      FILE,
      [
        "import { requireIdentity } from '@/lib/auth'",
        '// requireIdentity(request) is called upstream',
        '/* requireIdentity(req) */',
        'export async function GET() {',
        "  const note = 'requireIdentity(request)'",
        '  const tpl = `requireIdentity(${note})`',
        '  return new Response(tpl)',
        '}',
      ].join('\n')
    )
    expect(scan.methods).toEqual(['GET'])
    expect(callsAny(scan, AUTH_GUARDS)).toBe(false)
  })

  it('accepts a real call to an imported guard, including aliased imports', () => {
    const scan = scanRouteSource(
      FILE,
      [
        "import { requireIdentity as who } from '@/lib/auth'",
        'export async function POST(req: Request) {',
        '  const id = await who(req)',
        '  return Response.json(id)',
        '}',
      ].join('\n')
    )
    expect(callsAny(scan, AUTH_GUARDS)).toBe(true)
  })

  it('rejects a local function that shadows a guard name', () => {
    const scan = scanRouteSource(
      FILE,
      [
        'async function requireAuth() { return { userId: "x" } }',
        'export async function GET() {',
        '  await requireAuth()',
        "  return new Response('ok')",
        '}',
      ].join('\n')
    )
    expect(scan.calls.has('local#requireAuth')).toBe(true)
    expect(callsAny(scan, AUTH_GUARDS)).toBe(false)
  })

  it('detects `export const` handlers and `export { x as GET }` re-exports', () => {
    const scan = scanRouteSource(
      FILE,
      [
        "export const runtime = 'nodejs'",
        'export const POST = async () => new Response()',
        'async function handler() { return new Response() }',
        'export { handler as GET, handler as DELETE }',
      ].join('\n')
    )
    expect(scan.methods).toEqual(['DELETE', 'GET', 'POST'])
  })

  it('resolves relative imports and imported-object method calls', () => {
    const scan = scanRouteSource(
      'app/api/hooks/stop/route.ts',
      [
        "import { handleHookRequest } from '../_handler'",
        "import { authService } from '@/lib/services/auth.service'",
        'export async function POST(r: Request) {',
        '  await authService.verifyApiKey("t")',
        "  return handleHookRequest(r, 'STOP')",
        '}',
      ].join('\n')
    )
    expect(scan.calls.has('app/api/hooks/_handler#handleHookRequest')).toBe(
      true
    )
    expect(callsAny(scan, AUTH_GUARDS)).toBe(true)
  })

  it('treats a file without HTTP handler exports as not a handler route', () => {
    const scan = scanRouteSource(FILE, 'export const maxDuration = 60')
    expect(scan.methods).toEqual([])
  })
})
