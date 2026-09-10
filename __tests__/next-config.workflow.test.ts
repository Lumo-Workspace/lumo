/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('Vercel Workflows wiring (LUM-735 v4)', () => {
  it('next.config.mjs wraps the config with withWorkflow outside tests', () => {
    const src = readFileSync(join(root, 'next.config.mjs'), 'utf8')
    expect(src).toMatch(/import \{ withWorkflow \} from 'workflow\/next'/)
    expect(src).toMatch(/process\.env\.NODE_ENV === 'test'/)
    expect(src).toMatch(/withWorkflow\(nextConfig\)/)
  })

  it('declares workflow as a runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.dependencies.workflow).toMatch(/^\^4\./)
  })

  it('maps the ESM-only workflow entrypoints to Jest stubs', () => {
    const cfg = readFileSync(join(root, 'jest.config.js'), 'utf8')
    expect(cfg).toContain("'^workflow$': '<rootDir>/__stubs__/workflow.ts'")
    expect(cfg).toContain(
      "'^workflow/api$': '<rootDir>/__stubs__/workflow-api.ts'"
    )
  })
})
