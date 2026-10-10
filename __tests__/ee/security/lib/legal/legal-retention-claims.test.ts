/**
 * LUM-915 — plugin half of __tests__/lib/legal/legal-retention-claims.test.ts
 * (split in LUM-1065): the privacy policy and DPA quote the security scan
 * evidence figures the installed security plugin contributes (LUM-1062).
 */
import fs from 'fs'
import path from 'path'

import { retentionFigures } from '@/lib/legal/retention-figures'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const POLICY = 'docs/live-docs/legal-privacy-policy.md'
const DPA = 'docs/live-docs/legal-dpa-template.md'

function orList(days: readonly number[]): string {
  const all = days.map(String)
  return `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`
}

function row(doc: string, label: string): string {
  const line = doc.split('\n').find(l => l.startsWith(`| ${label}`))
  expect(line).toBeDefined()
  return line as string
}

describe('legal retention claims LUM-915 — security scan evidence', () => {
  const scanFigures = retentionFigures().contributed.find(
    c => c.paragraph === 'scan'
  )
  it('the security plugin contributes the scan figures', () => {
    expect(scanFigures).toBeDefined()
  })
  const v = scanFigures?.values ?? {}
  const scanDefault = v.scanDefault as number
  const scanTiers = (v.scanTiers ?? []) as readonly number[]
  const openCap = v.openCap as number

  it('privacy policy scan evidence row quotes the plugin constants', () => {
    const policy = read(POLICY)
    const scan = row(policy, 'Security scan evidence')
    expect(scan).toContain(
      `cleared ${scanDefault} days after the pull request is merged or closed`
    )
    expect(scan).toContain(`choose ${orList(scanTiers)} days`)
    expect(scan).toContain(`cleared ${openCap} days after the scan finished`)
    // The pre-LUM-911 sentence promised scan code for the workspace's life.
    expect(policy).not.toMatch(
      /code excerpts attached to findings are kept for as long as the workspace exists/
    )
  })

  it('DPA retention row quotes the plugin scan constants', () => {
    const retention = row(read(DPA), 'Retention')
    expect(retention).toContain(
      `cleared ${scanDefault} days after the pull request is merged or closed by default (${orList(scanTiers)} days selectable; at most ${openCap} days`
    )
  })
})
