/**
 * @jest-environment node
 *
 * LUM-1065 — the LUM-907 audit coverage guard (__tests__/audit/coverage-guard.test.ts)
 * for the security plugin, whose units moved into ee/security/ with their
 * registry entries (ee/security/audit-coverage.ts). It fails when:
 *  - a plugin unit stops calling recordAuditEvent with its actions;
 *  - a new OWNER-gated function / service method appears in the plugin tree
 *    without being classified;
 *  - an action the core leaves to the plugin (AUDIT_PLUGIN_ACTIONS) is
 *    written by no plugin unit;
 *  - a registry entry names a file or unit that does not exist, or is
 *    classified by both the core and the plugin;
 *  - a call of an audited plugin method from app/ does not hand that call an
 *    audit context.
 */
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import {
  AUDIT_EXEMPT,
  AUDIT_INSTRUMENTED,
  AUDIT_PENDING,
  AUDIT_PLUGIN_ACTIONS,
  auditedCallArguments,
  instrumentedCallPatterns,
  ownerGatedUnits,
  passesAuditContext,
  unitBody,
  type AuditUnit,
} from '@/lib/audit/coverage'
import {
  SECURITY_AUDIT_EXEMPT,
  SECURITY_AUDIT_INSTRUMENTED,
} from '@/ee/security/audit-coverage'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const split = (unit: string) => {
  const i = unit.lastIndexOf('#')
  return [unit.slice(0, i), unit.slice(i + 1)] as const
}
const lsFiles = (...globs: string[]) =>
  execSync(`git ls-files ${globs.map(g => `'${g}'`).join(' ')}`, { cwd: ROOT })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)

describe('LUM-907 audit coverage guard — security plugin (LUM-1065)', () => {
  it('every plugin instrumented unit calls recordAuditEvent with each of its actions', () => {
    for (const [unit, actions] of Object.entries(SECURITY_AUDIT_INSTRUMENTED)) {
      const [file, name] = split(unit)
      const body = unitBody(read(file), name)
      expect([unit, body !== null]).toEqual([unit, true])
      expect([unit, /\brecordAuditEvent\(/.test(body!)]).toEqual([unit, true])
      for (const action of actions)
        expect([unit, action, body!.includes(`'${action}'`)]).toEqual([
          unit,
          action,
          true,
        ])
    }
  })

  it('every OWNER-gated unit of the plugin tree is instrumented or exempt', () => {
    const classified = new Set<string>([
      ...Object.keys(SECURITY_AUDIT_INSTRUMENTED),
      ...Object.keys(SECURITY_AUDIT_EXEMPT),
    ])
    const gated = lsFiles('ee/**/*.ts').flatMap(f =>
      ownerGatedUnits(f, read(f))
    )
    expect(gated.length).toBeGreaterThan(0)
    expect(gated.filter(u => !classified.has(u))).toEqual([])
  })

  it('the actions the core leaves to the plugin are exactly the ones the plugin writes', () => {
    expect(
      [...new Set(Object.values(SECURITY_AUDIT_INSTRUMENTED).flat())].sort()
    ).toEqual([...AUDIT_PLUGIN_ACTIONS].sort())
  })

  it('registry entries name real plugin units, and none is also in the core registry', () => {
    const core = new Set<string>([
      ...Object.keys(AUDIT_INSTRUMENTED),
      ...Object.keys(AUDIT_PENDING),
      ...Object.keys(AUDIT_EXEMPT),
    ])
    for (const unit of [
      ...Object.keys(SECURITY_AUDIT_INSTRUMENTED),
      ...Object.keys(SECURITY_AUDIT_EXEMPT),
    ]) {
      const [file, name] = split(unit)
      expect([unit, file.startsWith('ee/security/')]).toEqual([unit, true])
      expect([unit, unitBody(read(file), name) !== null]).toEqual([unit, true])
      expect([unit, core.has(unit)]).toEqual([unit, false])
    }
    for (const reason of Object.values(SECURITY_AUDIT_EXEMPT))
      expect(reason.trim().length).toBeGreaterThan(0)
  })

  it('every app call of an audited plugin method passes an audit context in that call', () => {
    const patterns = Object.keys(SECURITY_AUDIT_INSTRUMENTED).map(u => ({
      unit: u,
      p: instrumentedCallPatterns(u as AuditUnit, read(split(u)[0])),
    }))
    const sites: Array<{ file: string; unit: string; ok: boolean }> = []
    for (const file of lsFiles('app/**/*.ts', 'app/**/*.tsx')) {
      const src = read(file)
      for (const { unit, p } of patterns)
        for (const call of auditedCallArguments(src, p, file))
          sites.push({ file, unit, ok: passesAuditContext(src, call) })
    }
    // The two disposition routes are found.
    const callers = [...new Set(sites.map(s => s.file))].sort()
    expect(callers).toEqual([
      'app/api/tasks/[id]/security-findings/[findingId]/disposition/route.ts',
      'app/api/tasks/[id]/security-findings/bulk-disposition/route.ts',
    ])
    expect(sites.filter(s => !s.ok)).toEqual([])
  })
})
