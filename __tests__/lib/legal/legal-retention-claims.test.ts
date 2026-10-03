/**
 * LUM-915 — the privacy policy and DPA sources (docs/live-docs/legal-*.md)
 * quote the shipped retention defaults and tiers. The figures each sentence
 * names are built from the lib constants, so changing a tier or a default
 * without updating the legal sources fails here.
 */
import fs from 'fs'
import path from 'path'

import { RETENTION_FIGURES } from '@/lib/legal/retention-figures'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const POLICY = 'docs/live-docs/legal-privacy-policy.md'
const DPA = 'docs/live-docs/legal-dpa-template.md'

/** "30, 90, 180 or 365": the legal sources' list style. */
function orList(days: readonly number[]): string {
  const all = days.map(String)
  return `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`
}

/** The table row whose first cell starts with `label`. */
function row(doc: string, label: string): string {
  const line = doc.split('\n').find(l => l.startsWith(`| ${label}`))
  expect(line).toBeDefined()
  return line as string
}

describe('legal retention claims LUM-915', () => {
  const f = RETENTION_FIGURES

  it('privacy policy retention rows quote the retention constants', () => {
    const policy = read(POLICY)

    const session = row(policy, 'Agent hook events (session records)')
    expect(session).toMatch(/By default, for as long as the workspace exists/)
    expect(session).toContain(`${orList(f.sessionDays)} days`)
    expect(session).toContain(`deleted ${f.grace} days after it is used up`)
    expect(session).toContain(`held up to ${f.auditCap} days after completion`)
    expect(session).toContain(`${f.idle} days pass with no agent activity`)
    expect(session).toContain(`plus ${f.grace} days`)

    const scan = row(policy, 'Security scan evidence')
    expect(scan).toContain(
      `cleared ${f.scanDefault} days after the pull request is merged or closed`
    )
    expect(scan).toContain(`choose ${orList(f.scanTiers)} days`)
    expect(scan).toContain(`cleared ${f.openCap} days after the scan finished`)
    // The pre-LUM-911 sentence promised scan code for the workspace's life.
    expect(policy).not.toMatch(
      /code excerpts attached to findings are kept for as long as the workspace exists/
    )

    const crossing = row(policy, 'Boundary-crossing records')
    expect(crossing).toContain(
      `${f.crossingDefault} days after the crossing is dispositioned`
    )
    expect(crossing).toContain(`choose ${orList(f.crossingTiers)} days`)

    const deadLetter = row(policy, 'Failed pull-request comment syncs')
    expect(deadLetter).toContain(
      `deleted ${f.deadLetterDefault} days after the sync failed`
    )
    expect(deadLetter).toContain(`choose ${orList(f.deadLetterTiers)} days`)

    // LUM-917 is not shipped: AI-derived content is only said to be kept.
    const derived = row(policy, 'AI-derived content')
    expect(derived).toMatch(/kept for as long as the workspace exists/)
    expect(derived).not.toMatch(/turn off|switch off|disable|delete/i)
  })

  it('privacy policy describes the uninstall scrub', () => {
    // LUM-860: uninstall (and repository removal) clears scan code
    // (github-app-install.service.ts scrubWorkspaceCode); the old sentence
    // said everything collected from GitHub was kept.
    const policy = read(POLICY)
    expect(policy).not.toMatch(
      /uninstall the GitHub App but keep the workspace, data already collected from GitHub is kept/
    )
    expect(policy).toMatch(
      /uninstall the GitHub App, or remove a repository from it, but keep the workspace, we immediately clear the code stored with the affected security scans/
    )
  })

  it('DPA retention row quotes the retention constants', () => {
    const dpa = read(DPA)
    const retention = row(dpa, 'Retention')
    expect(retention).toContain(
      `${orList(f.sessionDays)} days after each event`
    )
    expect(retention).toContain(
      `discarded ${f.grace} days after they are used up`
    )
    expect(retention).toContain(
      `cleared ${f.scanDefault} days after the pull request is merged or closed by default (${orList(f.scanTiers)} days selectable; at most ${f.openCap} days`
    )
    expect(retention).toContain(
      `${f.crossingDefault} days after disposition by default (${orList(f.crossingTiers)} days selectable)`
    )
    expect(retention).toContain(
      `deleted ${f.deadLetterDefault} days after the failure by default (${orList(f.deadLetterTiers)} days selectable)`
    )
  })

  it('legal sources claim no Lumo-side encryption of session records', () => {
    // Storage relies on the providers' at-rest encryption; the only
    // application-layer encryption is for integration tokens (lib/crypto.ts).
    for (const doc of [read(POLICY), read(DPA)]) {
      for (const line of doc.split('\n')) {
        if (/AES-256-GCM/.test(line))
          expect(line).toMatch(/integration access tokens/i)
        expect(line).not.toMatch(
          /per-workspace key|separate key|crypto-?shred/i
        )
      }
    }
  })

  it('legal sources no longer describe acceptance criteria or lumo verify', () => {
    // LUM-942 (#1209/#1210/#1211) removed acceptance criteria, lumo verify and
    // verification rounds; test cases remain, and DONE is held only by open
    // boundary crossings, blocking security findings and test-case defects
    // (lib/services/done-verdict.service.ts).
    for (const doc of [read(POLICY), read(DPA)]) {
      expect(doc).not.toMatch(
        /acceptance criteri|acceptance verification|verifying acceptance|agent-verification|lumo verify|verification round|verdict/i
      )
      // The only "verify" left is identity verification for rights requests.
      for (const line of doc.split('\n'))
        if (/verif/i.test(line)) expect(line).toMatch(/verify your identity/)
    }
    expect(row(read(POLICY), 'Workspace content')).toMatch(
      /test cases and their run records/
    )
    expect(row(read(DPA), 'Workspace content')).toMatch(
      /test cases and their run records/
    )
  })
})
