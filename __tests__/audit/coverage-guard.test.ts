/**
 * @jest-environment node
 *
 * LUM-907 coverage guard: sensitive mutations must write an audit event.
 * The inventory rule (audit every sensitive mutation by category, whoever
 * performs it) and the buckets — instrumented, exempt, and a pending list
 * that must stay empty since PR3 — are documented in lib/audit/coverage.ts.
 * This suite fails when:
 *  - an instrumented unit stops calling recordAuditEvent with its actions;
 *  - a new OWNER-gated function / service method / route handler appears in
 *    lib/services or app/api without being classified;
 *  - an action in AUDIT_ACTIONS is written nowhere;
 *  - a registry entry names a file or unit that does not exist;
 *  - anything is parked in the pending list;
 *  - a call of an audited method from app/ does not hand that call an audit
 *    context (call-level: mentioning memberAuditContext elsewhere in the
 *    file does not count).
 */
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import {
  AUDIT_EXEMPT,
  AUDIT_INDIRECT_ACTIONS,
  AUDIT_INSTRUMENTED,
  AUDIT_PENDING,
  AUDIT_PLUGIN_ACTIONS,
  auditedCallArguments,
  callsInstrumentedUnit,
  importedModules,
  instrumentedCallPatterns,
  passesAuditContext,
  ownerGatedUnits,
  parseUnits,
  unitBody,
  type AuditUnit,
} from '@/lib/audit/coverage'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { AUDITED_WORKSPACE_SETTINGS } from '@/lib/audit/workspace-settings'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const split = (unit: string) => {
  const i = unit.lastIndexOf('#')
  return [unit.slice(0, i), unit.slice(i + 1)] as const
}

const SCANNED = execSync(
  "git ls-files 'lib/services/*.ts' 'lib/services/**/*.ts' 'app/api/**/route.ts'",
  { cwd: ROOT }
)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)

describe('LUM-907 audit coverage guard', () => {
  it('LUM-907 audit coverage: every instrumented unit calls recordAuditEvent with each of its actions', () => {
    for (const [unit, actions] of Object.entries(AUDIT_INSTRUMENTED)) {
      const [file, name] = split(unit)
      const body = unitBody(read(file), name)
      expect([unit, body !== null]).toEqual([unit, true])
      expect([unit, /\brecordAuditEvent\(/.test(body!)]).toEqual([unit, true])
      for (const action of actions) {
        expect([unit, action, body!.includes(`'${action}'`)]).toEqual([
          unit,
          action,
          true,
        ])
      }
    }
  })

  it('LUM-907 audit coverage: every OWNER-gated unit is instrumented, pending or exempt', () => {
    const classified = new Set<string>([
      ...Object.keys(AUDIT_INSTRUMENTED),
      ...Object.keys(AUDIT_PENDING),
      ...Object.keys(AUDIT_EXEMPT),
    ])
    const gated = SCANNED.flatMap(f => ownerGatedUnits(f, read(f)))
    expect(gated.length).toBeGreaterThan(20)
    expect(gated.filter(u => !classified.has(u))).toEqual([])
  })

  it('LUM-907 audit coverage: every audit action is written by some unit', () => {
    const written = new Set<string>([
      ...Object.values(AUDIT_INSTRUMENTED).flat(),
      ...Object.values(AUDIT_INDIRECT_ACTIONS).flat(),
    ])
    // LUM-1065: a plugin's actions are written by the plugin (checked by its
    // own guard), and never also by the core.
    expect(AUDIT_PLUGIN_ACTIONS.filter(a => written.has(a))).toEqual([])
    expect(
      AUDIT_ACTIONS.filter(
        a => !written.has(a) && !AUDIT_PLUGIN_ACTIONS.includes(a)
      )
    ).toEqual([])
    // The indirect settings actions are exactly the diff's actions.
    expect(
      [
        ...(AUDIT_INDIRECT_ACTIONS[
          'lib/services/workspace.service.ts#updateWorkspace'
        ] ?? []),
      ].sort()
    ).toEqual(Object.keys(AUDITED_WORKSPACE_SETTINGS).sort())
    for (const unit of Object.keys(AUDIT_INDIRECT_ACTIONS)) {
      expect(AUDIT_INSTRUMENTED).toHaveProperty([unit])
    }
  })

  it('LUM-907 audit coverage: registry entries name real units and never two buckets', () => {
    const buckets = [AUDIT_INSTRUMENTED, AUDIT_PENDING, AUDIT_EXEMPT]
    const all = buckets.flatMap(b => Object.keys(b)) as AuditUnit[]
    expect(new Set(all).size).toBe(all.length)
    for (const unit of all) {
      const [file, name] = split(unit)
      expect([unit, unitBody(read(file), name) !== null]).toEqual([unit, true])
    }
    for (const reason of [
      ...Object.values(AUDIT_PENDING),
      ...Object.values(AUDIT_EXEMPT),
    ]) {
      expect(reason.trim().length).toBeGreaterThan(0)
    }
  })

  it('LUM-907 audit coverage: every app call of an instrumented method passes an audit context in that call', () => {
    // `fooBarService.baz(`, or a module-level `baz(` imported from its module
    // (Figma / Google Drive), or a service-object alias of it.
    const patterns = Object.keys(AUDIT_INSTRUMENTED).map(u => ({
      unit: u,
      p: instrumentedCallPatterns(u as AuditUnit, read(split(u)[0])),
    }))
    const files = execSync("git ls-files 'app/**/*.ts' 'app/**/*.tsx'", {
      cwd: ROOT,
    })
      .toString()
      .trim()
      .split('\n')
    const sites: Array<{ file: string; unit: string; ok: boolean }> = []
    for (const file of files) {
      const src = read(file)
      for (const { unit, p } of patterns) {
        for (const call of auditedCallArguments(src, p, file)) {
          sites.push({ file, unit, ok: passesAuditContext(src, call) })
        }
      }
    }
    const callers = [...new Set(sites.map(s => s.file))]
    expect(callers.length).toBeGreaterThan(35)
    // The PR3 routes, including the direct-import ones, are found.
    for (const route of [
      'app/api/figma/callback/route.ts',
      'app/api/google-drive/route.ts',
      'app/api/workspaces/me/audit-events/export/route.ts',
      'app/api/users/api-keys/route.ts',
    ]) {
      expect([route, callers.includes(route)]).toEqual([route, true])
    }
    expect(sites.filter(s => !s.ok)).toEqual([])
  })

  it('LUM-907 audit coverage: a call that omits the context fails even when the file mentions memberAuditContext elsewhere', () => {
    const p = instrumentedCallPatterns(
      'lib/services/sentry.service.ts#disconnectIntegration',
      read('lib/services/sentry.service.ts')
    )
    const route = [
      "import { memberAuditContext } from '@/lib/api/audit-context'",
      "import { sentryService } from '@/lib/services/sentry.service'",
      'export async function POST(request: Request) {',
      '  const ctx = memberAuditContext(request.headers, { clerkId: u })',
      '  await other(ctx)',
      '  await sentryService.disconnectIntegration(ws.workspaceId, role)',
      '}',
    ].join('\n')
    // The old file-level check would have passed this file.
    expect(route.includes('memberAuditContext(')).toBe(true)
    const calls = auditedCallArguments(route, p, 'app/api/x/route.ts')
    expect(calls.map(c => c.args)).toEqual(['(ws.workspaceId, role)'])
    expect(passesAuditContext(route, calls[0]!)).toBe(false)
    // Passing it inline, or through the binding, is accepted.
    for (const call of [
      'sentryService.disconnectIntegration(ws.workspaceId, role, memberAuditContext(request.headers, {}))',
      'sentryService.disconnectIntegration(ws.workspaceId, role, ctx)',
      'sentryService.disconnectIntegration(ws.workspaceId, role, SYSTEM_AUDIT_CONTEXT)',
    ]) {
      const src = route.replace(
        'sentryService.disconnectIntegration(ws.workspaceId, role)',
        call
      )
      const [site] = auditedCallArguments(src, p, 'app/api/x/route.ts')
      expect([call, passesAuditContext(src, site!)]).toEqual([call, true])
    }
    // A key named like the binding is not the binding.
    const keyOnly = route.replace(
      'sentryService.disconnectIntegration(ws.workspaceId, role)',
      'sentryService.disconnectIntegration({ ctx: null })'
    )
    const [keySite] = auditedCallArguments(keyOnly, p, 'app/api/x/route.ts')
    expect(passesAuditContext(keyOnly, keySite!)).toBe(false)
  })

  it('LUM-907 audit coverage: a same-named binding in another function, or after the call, does not count', () => {
    const p = instrumentedCallPatterns(
      'lib/services/sentry.service.ts#disconnectIntegration',
      read('lib/services/sentry.service.ts')
    )
    const file = 'app/api/x/route.ts'
    const otherFunction = [
      "import { memberAuditContext } from '@/lib/api/audit-context'",
      "import { sentryService } from '@/lib/services/sentry.service'",
      'export async function POST(request: Request) {',
      '  const ctx = memberAuditContext(request.headers, { clerkId: u })',
      '  await other(ctx)',
      '}',
      'export async function DELETE(request: Request) {',
      '  const ctx = null',
      '  await sentryService.disconnectIntegration(ws.workspaceId, role, ctx)',
      '}',
    ].join('\n')
    const [a] = auditedCallArguments(otherFunction, p, file)
    expect(passesAuditContext(otherFunction, a!)).toBe(false)
    // Declared after the call in the same function: not what the call got.
    const afterCall = [
      'export async function DELETE(request: Request) {',
      '  await sentryService.disconnectIntegration(ws.workspaceId, role, ctx)',
      '  const ctx = memberAuditContext(request.headers, {})',
      '}',
    ].join('\n')
    const [b] = auditedCallArguments(afterCall, p, file)
    expect(passesAuditContext(afterCall, b!)).toBe(false)
    // The same binding inside the calling function, before the call, passes.
    const sameFunction = otherFunction.replace(
      '  const ctx = null',
      '  const ctx = memberAuditContext(request.headers, {})'
    )
    const [c] = auditedCallArguments(sameFunction, p, file)
    expect(passesAuditContext(sameFunction, c!)).toBe(true)
  })

  it('LUM-907 audit coverage: comments in the arguments are skipped, apostrophes included', () => {
    const p = instrumentedCallPatterns(
      'lib/services/sentry.service.ts#disconnectIntegration',
      read('lib/services/sentry.service.ts')
    )
    const src = [
      'export async function DELETE(request: Request) {',
      '  await sentryService.disconnectIntegration(',
      "    ws.workspaceId, // don't pass the slug (it's not an id)",
      "    /* the caller's role ) */ role,",
      '    memberAuditContext(request.headers, {})',
      '  )',
      '  await after()',
      '}',
    ].join('\n')
    const [site] = auditedCallArguments(src, p, 'app/api/x/route.ts')
    // The whole call is captured — the apostrophes and the ")" inside the
    // comments neither open a string nor close the call early.
    expect(
      site!.args.endsWith('memberAuditContext(request.headers, {})\n  )')
    ).toBe(true)
    expect(site!.args).not.toContain('after()')
    expect(passesAuditContext(src, site!)).toBe(true)
    // Without the context, a comment naming it does not make it pass.
    const omitted = src.replace(
      '    memberAuditContext(request.headers, {})',
      '    // memberAuditContext(request.headers) is not passed here'
    )
    const [bad] = auditedCallArguments(omitted, p, 'app/api/x/route.ts')
    expect(bad!.args).not.toContain('not passed here')
    expect(passesAuditContext(omitted, bad!)).toBe(false)
  })

  it('LUM-907 audit coverage: a binding passed through a ternary counts as passed', () => {
    const p = instrumentedCallPatterns(
      'lib/services/sentry.service.ts#disconnectIntegration',
      read('lib/services/sentry.service.ts')
    )
    const src = [
      'export async function DELETE(request: Request) {',
      '  const audit = memberAuditContext(request.headers, {})',
      '  await sentryService.disconnectIntegration(ws.workspaceId, role, isOwner ? audit : fallback)',
      '}',
    ].join('\n')
    const [site] = auditedCallArguments(src, p, 'app/api/x/route.ts')
    expect(passesAuditContext(src, site!)).toBe(true)
    // An object key of the same name is still not the binding.
    const keyOnly = src.replace(
      'isOwner ? audit : fallback',
      '{ audit: fallback }'
    )
    const [key] = auditedCallArguments(keyOnly, p, 'app/api/x/route.ts')
    expect(passesAuditContext(keyOnly, key!)).toBe(false)
  })

  it('LUM-907 audit coverage: the pending list is empty (PR3 enforcement)', () => {
    expect(AUDIT_PENDING).toEqual({})
  })

  it('LUM-907 audit coverage: a caller of a directly imported audited function is detected', () => {
    const moduleSrc = [
      'export async function completeOauthFlow(input: { a: string }) {',
      "  await recordAuditEvent({ action: 'figma.connected' })",
      '}',
      'export const figmaIntegrationService = {',
      '  connect: completeOauthFlow,',
      '}',
    ].join('\n')
    const p = instrumentedCallPatterns(
      'lib/services/figma-integration.service.ts#completeOauthFlow',
      moduleSrc
    )
    const caller = 'app/api/figma/callback/route.ts'
    for (const spec of [
      "'@/lib/services/figma-integration.service'",
      '"@/lib/services/figma-integration.service"',
      "'../../../../lib/services/figma-integration.service'",
      '"../../../../lib/services/figma-integration.service.ts"',
    ]) {
      const route = `import { completeOauthFlow } from ${spec}\nawait completeOauthFlow({ a: 1 })`
      expect([spec, callsInstrumentedUnit(route, p, caller)]).toEqual([
        spec,
        true,
      ])
    }
    // A relative path that resolves elsewhere is a different module.
    expect(
      callsInstrumentedUnit(
        "import { completeOauthFlow } from '../lib/services/figma-integration.service'\ncompleteOauthFlow()",
        p,
        caller
      )
    ).toBe(false)
    // Not imported from that module: some other completeOauthFlow.
    expect(
      callsInstrumentedUnit(
        "import { completeOauthFlow } from '@/lib/services/other'\ncompleteOauthFlow()",
        p,
        caller
      )
    ).toBe(false)
    // Through the service-object alias.
    expect(
      callsInstrumentedUnit(
        'await figmaIntegrationService.connect(x)',
        p,
        caller
      )
    ).toBe(true)
    expect(
      importedModules(
        'const m = await import("./sibling")',
        'app/api/a/route.ts'
      )
    ).toEqual(['app/api/a/sibling'])
  })

  it('LUM-907 audit coverage: a new OWNER-gated method without an audit fails the guard', () => {
    const src = [
      'export const fooService = {',
      '  async rotateSecret(workspaceId: string, role: string) {',
      "    if (role !== 'OWNER') throw new Error('no')",
      '    return 1',
      '  },',
      '}',
    ].join('\n')
    const gated = ownerGatedUnits('lib/services/foo.service.ts', src)
    expect(gated).toEqual(['lib/services/foo.service.ts#rotateSecret'])
    // The same classification the real scan uses: with pending empty, an
    // unregistered OWNER-gated mutation is unclassified and fails the guard.
    const classified = new Set<string>([
      ...Object.keys(AUDIT_INSTRUMENTED),
      ...Object.keys(AUDIT_PENDING),
      ...Object.keys(AUDIT_EXEMPT),
    ])
    expect(gated.filter(u => !classified.has(u))).toEqual([
      'lib/services/foo.service.ts#rotateSecret',
    ])
  })
})

describe('parseUnits', () => {
  it('splits top-level functions and object methods, not call statements', () => {
    const src = [
      'function assertOwner(role: string) {',
      "  if (role !== 'OWNER') throw new Error('x')",
      '}',
      'export async function GET(request: Request) {',
      '  assertOwner(role)',
      '  return 1',
      '}',
      'export const svc = {',
      '  async update(',
      '    id: string',
      '  ) {',
      '    return 2',
      '  },',
      '  list(id: string): Promise<number> {',
      '    return 3',
      '  },',
      '  remove: async (id: string) => 4,',
      '}',
    ].join('\n')
    expect(parseUnits(src).map(u => u.name)).toEqual([
      'assertOwner',
      'GET',
      'update',
      'list',
      'remove',
    ])
    expect(unitBody(src, 'GET')).toContain('assertOwner(role)')
    expect(unitBody(src, 'missing')).toBeNull()
  })
})
