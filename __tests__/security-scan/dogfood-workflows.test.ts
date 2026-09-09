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
      (yml.match(/github\/codeql-action\/upload-sarif@v3/g) ?? []).length
    ).toBe(2)
    expect(yml).toMatch(/pull_request:/)
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
    expect(yml).toMatch(/npx tsc --noEmit/)
    expect(yml).toMatch(/npm test/)
  })
})
