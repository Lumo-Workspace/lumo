/**
 * @jest-environment node
 *
 * LUM-907 coverage guard: sensitive mutations must write an audit event.
 * The inventory rule (audit every sensitive mutation by category, whoever
 * performs it) and the three buckets — instrumented, pending (LUM-907 PR3),
 * exempt — are documented in lib/audit/coverage.ts. This suite fails when:
 *  - an instrumented unit stops calling recordAuditEvent with its actions;
 *  - a new OWNER-gated function / service method / route handler appears in
 *    lib/services or app/api without being classified;
 *  - an action in AUDIT_ACTIONS is written nowhere;
 *  - a registry entry names a file or unit that does not exist.
 */
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import {
  AUDIT_EXEMPT,
  AUDIT_INDIRECT_ACTIONS,
  AUDIT_INSTRUMENTED,
  AUDIT_PENDING,
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
    // lib/services/foo-bar.service.ts#baz → `fooBarService.baz(`
    const calls = Object.keys(AUDIT_INSTRUMENTED).map(u => {
      const [file, name] = split(u)
      const service = path
        .basename(file, '.service.ts')
        .replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
      return `${service}Service\\.${name}\\(`
    })
    const callRe = new RegExp(calls.join('|'))
    const callers = execSync("git ls-files 'app/**/*.ts' 'app/**/*.tsx'", {
      cwd: ROOT,
    })
      .toString()
      .trim()
      .split('\n')
      .filter(f => callRe.test(read(f)))
    expect(callers.length).toBeGreaterThan(15)
    for (const file of callers) {
      expect([file, read(file).includes('memberAuditContext(')]).toEqual([
        file,
        true,
      ])
    }
  })

  it('LUM-907 audit coverage: PR1 declares its pending list (PR3 empties it)', () => {
    // PR3 flips this to `toEqual({})` and keeps it there.
    expect(Object.keys(AUDIT_PENDING).length).toBeGreaterThan(0)
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
    const classified = new Set(Object.keys(AUDIT_INSTRUMENTED))
    expect(gated.filter(u => !classified.has(u))).toHaveLength(1)
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
