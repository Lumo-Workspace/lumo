/**
 * @jest-environment node
 *
 * LUM-1078 — docs/self-hosting/integrations.md is held to the code it was
 * derived from: every env var the configured-check requires, every scope the
 * connect flows request, every webhook event the GitHub route handles, and
 * every source file it cites must still be there. Change one side without the
 * other and this fails.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { integrationConfigStatus } from '@/lib/integrations/configured'
import { FIGMA_OAUTH_SCOPES } from '@/lib/integrations/figma/oauth'
import { GOOGLE_DRIVE_OAUTH_SCOPES } from '@/lib/integrations/google-drive/oauth'
import { FEISHU_ACCOUNT_SCOPES } from '@/lib/integrations/feishu/oauth'

const ROOT = join(__dirname, '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const doc = read('docs/self-hosting/integrations.md')

describe('self-hosting integrations guide', () => {
  it('names every env var each integration needs to count as configured', () => {
    const ids = [
      'github',
      'githubAccount',
      'slack',
      'figma',
      'googleDrive',
      'sentry',
      'feishu',
      'feishuAccount',
    ] as const
    for (const id of ids) {
      for (const name of integrationConfigStatus(id, {}).missing) {
        expect(
          `${id}: ${doc.includes(`\`${name}\``) || doc.includes(`${name}=`)}`
        ).toBe(`${id}: true`)
      }
    }
  })

  it('lists every Slack scope the install link requests, and no other', () => {
    const route = read('app/api/slack/oauth/route.ts')
    const block = route.slice(
      route.indexOf('const SLACK_SCOPES = ['),
      route.indexOf("].join(',')")
    )
    const scopes = [...block.matchAll(/'([a-z_.:]+)'/g)].map(m => m[1]!)
    expect(scopes.length).toBeGreaterThan(5)
    for (const s of scopes) expect(doc).toContain(`\`${s}\``)
    // The bot-scope table under ## Slack names no scope the link does not ask for.
    const slack = doc.slice(doc.indexOf('## Slack'), doc.indexOf('## Figma'))
    const table = [...slack.matchAll(/^\s*\| `([a-z_.:]+)`/gm)].map(m => m[1]!)
    expect(table.sort()).toEqual([...scopes].sort())
  })

  it('lists the Figma and Google Drive scopes', () => {
    for (const s of [...FIGMA_OAUTH_SCOPES, ...GOOGLE_DRIVE_OAUTH_SCOPES])
      expect(doc).toContain(`\`${s}\``)
  })

  it('LUM-1341: lists every Feishu scope and both redirect URLs', () => {
    const feishu = doc.slice(
      doc.indexOf('## Feishu / Lark'),
      doc.indexOf('## Sentry')
    )
    for (const s of [...FEISHU_ACCOUNT_SCOPES, 'tenant:tenant:readonly'])
      expect(feishu).toContain(`\`${s}\``)
    expect(feishu).toContain('/api/feishu/install/callback')
    expect(feishu).toContain('/api/feishu/account/callback')
  })

  it('lists every GitHub webhook event the route handles', () => {
    const route = read('app/api/webhooks/github/route.ts')
    const repoEvents = [...route.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]!)
    const appBlock = route.slice(
      route.indexOf('const APP_EVENTS = new Set(['),
      route.indexOf('])', route.indexOf('const APP_EVENTS = new Set(['))
    )
    const appEvents = [...appBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]!)
    expect(appEvents).toEqual(
      expect.arrayContaining(['installation', 'installation_repositories'])
    )
    expect(repoEvents.length).toBeGreaterThan(4)
    for (const e of [...repoEvents, ...appEvents])
      expect(doc).toContain(`\`${e}\``)
  })

  it('cites only source files that exist', () => {
    const cited = [
      ...doc.matchAll(/`((?:lib|app)\/[A-Za-z0-9_./[\]-]+\.tsx?)`/g),
    ].map(m => m[1]!)
    expect(cited.length).toBeGreaterThan(10)
    expect(cited.filter(p => !existsSync(join(ROOT, p)))).toEqual([])
  })

  it('uses placeholders, never credential-shaped values', () => {
    expect(doc).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/)
    expect(doc).not.toMatch(/\b(ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9]{10,}/)
    expect(doc).not.toMatch(/\bIv1\.[0-9a-f]{8,}/)
  })
})
