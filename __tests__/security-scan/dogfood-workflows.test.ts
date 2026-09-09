/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyGateName } from '@/shared/src/gate-map'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// Extracts the push.mjs heredoc body (between `<<'EOF'` and the closing
// `EOF` line) from a "Push report to Lumo" step so both jobs' scripts can
// be compared verbatim.
const extractPushScript = (yml: string): string[] =>
  [...yml.matchAll(/<<'EOF'\n([\s\S]*?)\n\s*EOF\n/g)].map(m => m[1]!)

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
    // One run per PR (LUM-735 review I3): overlapping runs from a push train
    // leave several ingests racing for the same scan row.
    expect(yml).toMatch(
      /^concurrency:\n\s+group: lumo-security-\$\{\{ github\.event\.pull_request\.number \}\}\n\s+cancel-in-progress: true$/m
    )
    // Findings go straight to Lumo via Blob; GitHub code scanning is unused.
    expect(yml).not.toMatch(/upload-sarif/)
    // LUM-735 (v3): the workflow authenticates with its own GitHub Actions
    // OIDC ID token — no secret required for GitHub Actions callers.
    expect(yml).toMatch(/id-token:\s*write/)
    expect(yml).toMatch(/ACTIONS_ID_TOKEN_REQUEST_URL/)
    expect(yml).toMatch(/audience=lumo/)
    // Inside the gitleaks container git refuses the runner-owned checkout
    // ("dubious ownership") and gitleaks then scans 0 commits as "no leaks".
    expect(yml).toMatch(/safe\.directory/)
    expect(yml).toMatch(/rev-list --count HEAD/)
    // One "Push report to Lumo" step per job (semgrep + gitleaks).
    expect((yml.match(/continue-on-error:\s*true/g) ?? []).length).toBe(2)
    // Node 20 action runtimes / stale checkout majors are deprecated.
    expect(yml).not.toMatch(/@v3\b/)
    expect(yml).not.toMatch(/checkout@v4/)

    // `npx -y -p @vercel/blob ...` can't resolve the `@vercel/blob/client`
    // bare specifier (ESM resolves from the eval referrer, never reaching
    // the npx cache) — the push step must install into a fixed prefix dir
    // and run a real script file instead.
    expect(yml).not.toMatch(/npx -y -p @vercel\/blob/)
    expect((yml.match(/npm install --prefix/g) ?? []).length).toBe(2)
    // push.mjs is written and then invoked, once per job (semgrep + gitleaks).
    expect((yml.match(/push\.mjs/g) ?? []).length).toBe(4)
    // Both docker scans need git to treat the bind-mounted checkout as safe
    // (semgrep's --baseline-commit, gitleaks' history walk) without shelling
    // out to `git config --global` inside the container.
    expect((yml.match(/GIT_CONFIG_KEY_0=safe\.directory/g) ?? []).length).toBe(
      2
    )

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
