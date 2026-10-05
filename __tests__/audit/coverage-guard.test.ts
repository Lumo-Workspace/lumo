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
 *  - an app caller of an audited method passes no request audit context.
 */
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import {
  AUDIT_EXEMPT,
  AUDIT_INDIRECT_ACTIONS,
  AUDIT_INSTRUMENTED,
  AUDIT_PENDING,
  callsInstrumentedUnit,
  instrumentedCallPatterns,
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
    expect(AUDIT_ACTIONS.filter(a => !written.has(a))).toEqual([])
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

  it('LUM-907 audit coverage: every app caller of an instrumented method passes a request audit context', () => {
    // `fooBarService.baz(`, or a module-level `baz(` imported from its module
    // (Figma / Google Drive), or a service-object alias of it.
    const patterns = Object.keys(AUDIT_INSTRUMENTED).map(u =>
      instrumentedCallPatterns(u as AuditUnit, read(split(u)[0]))
    )
    const callers = execSync("git ls-files 'app/**/*.ts' 'app/**/*.tsx'", {
      cwd: ROOT,
    })
      .toString()
      .trim()
      .split('\n')
      .filter(f => {
        const src = read(f)
        return patterns.some(p => callsInstrumentedUnit(src, p))
      })
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
    for (const file of callers) {
      expect([file, read(file).includes('memberAuditContext(')]).toEqual([
        file,
        true,
      ])
    }
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
    const route = [
      "import { completeOauthFlow } from '@/lib/services/figma-integration.service'",
      'await completeOauthFlow({ a: 1 })',
    ].join('\n')
    expect(callsInstrumentedUnit(route, p)).toBe(true)
    // Not imported from that module: some other completeOauthFlow.
    expect(
      callsInstrumentedUnit(
        "import { completeOauthFlow } from '@/lib/services/other'\ncompleteOauthFlow()",
        p
      )
    ).toBe(false)
    // Through the service-object alias.
    expect(
      callsInstrumentedUnit('await figmaIntegrationService.connect(x)', p)
    ).toBe(true)
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
