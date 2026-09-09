/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyGateName } from '@/shared/src/gate-map'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('LUM-735 dogfood workflows', () => {
  it('security.yml runs semgrep + gitleaks and uploads SARIF with security-events: write', () => {
    const yml = read('.github/workflows/security.yml')
    expect(yml).toMatch(/security-events:\s*write/)
    expect(yml).toMatch(/p\/owasp-top-ten/)
    expect(yml).toMatch(/p\/typescript/)
    expect(yml).toMatch(/p\/nodejs/)
    expect(yml).toMatch(/gitleaks/)
    expect(
      (yml.match(/github\/codeql-action\/upload-sarif@v4/g) ?? []).length
    ).toBe(2)
    expect(yml).toMatch(/pull_request:/)
    // Findings travel as SARIF; `--error` would turn every finding into a red
    // job and hide real semgrep failures behind the same exit code.
    expect(yml).not.toMatch(/^\s*--error\s*$/m)
    // Inside the gitleaks container git refuses the runner-owned checkout
    // ("dubious ownership") and gitleaks then scans 0 commits as "no leaks".
    expect(yml).toMatch(/safe\.directory/)
    expect(yml).toMatch(/git rev-list --count HEAD/)
    // Node 20 action runtimes are deprecated on the runners.
    expect(yml).not.toMatch(/@v3\b/)
    expect(yml).not.toMatch(/checkout@v4/)
  })

  it('ci.yml job names classify as the typecheck and test gates', () => {
    const yml = read('.github/workflows/ci.yml')
    const names = [...yml.matchAll(/^\s{4}name:\s*(.+)$/gm)].map(m =>
      m[1]!.trim()
    )
    expect(names.map(classifyGateName)).toEqual(
      expect.arrayContaining(['typecheck', 'test'])
    )
    expect(yml).toMatch(/npx prisma generate/)
    // @lumo/shared is consumed from shared/dist; both jobs must build it first.
    expect((yml.match(/npm run build:shared/g) ?? []).length).toBe(2)
    expect(yml).toMatch(/npx tsc --noEmit/)
    expect(yml).toMatch(/npm test/)
    // The 5 suites stale since LUM-733 (fail on main) must be excluded so
    // the `test` job stays a meaningful independent gate signal.
    for (const stale of [
      'cli/__tests__/commands/task-criteria-set.readback.test.ts',
      'cli/__tests__/commands/task-status.cost.render.test.ts',
      'cli/__tests__/commands/task-status.render.test.ts',
      '__tests__/machine-verdict.validation.test.ts',
      '__tests__/task-criteria-activity.test.ts',
    ]) {
      expect(yml).toContain(stale)
    }
  })
})
