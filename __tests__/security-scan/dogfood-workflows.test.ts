/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyGateName } from '@/shared/src/gate-map'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// Extracts the `npx -y -p @vercel/blob ... '` push-script body from a
// "Push report to Lumo" step so both jobs' scripts can be compared verbatim.
const extractPushScript = (yml: string): string[] =>
  [...yml.matchAll(/npx -y -p @vercel\/blob[\s\S]*?\n\s*'/g)].map(m => m[0])

describe('LUM-735 dogfood workflows', () => {
  it('security.yml matches the published lumo-security.yml template and pushes SARIF straight to Lumo', () => {
    const yml = read('.github/workflows/security.yml')
    const template = read('public/integrations/lumo-security.yml')

    // Lumo dogfoods its own template — the repo's workflow must be the
    // published template, byte for byte.
    expect(yml).toBe(template)

    expect(yml).toMatch(/\/api\/integrations\/security\/sarif\/upload/)
    expect(yml).toMatch(/\/api\/integrations\/security\/sarif\/complete/)
    expect(yml).toMatch(/access:\s*"private"/)
    expect(yml).toMatch(/LUMO_SECURITY_TOKEN/)
    // Findings go straight to Lumo via Blob; GitHub code scanning is unused.
    expect(yml).not.toMatch(/upload-sarif/)
    // Inside the gitleaks container git refuses the runner-owned checkout
    // ("dubious ownership") and gitleaks then scans 0 commits as "no leaks".
    expect(yml).toMatch(/safe\.directory/)
    expect(yml).toMatch(/rev-list --count HEAD/)
    // One "Push report to Lumo" step per job (semgrep + gitleaks).
    expect((yml.match(/continue-on-error:\s*true/g) ?? []).length).toBe(2)
    // Node 20 action runtimes / stale checkout majors are deprecated.
    expect(yml).not.toMatch(/@v3\b/)
    expect(yml).not.toMatch(/checkout@v4/)

    // The two "Push report to Lumo" steps must run the identical script.
    const scripts = extractPushScript(yml)
    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toBe(scripts[1])
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
