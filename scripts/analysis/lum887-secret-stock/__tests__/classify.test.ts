/** @jest-environment node */
import { classifyRow, classifyStoredText, stringsOf } from '../classify'
import { STOCK_TABLES } from '../tables'
import { redactSecret } from '@/lib/security-scan/redact'

const DASHES = '-'.repeat(5)
const header = `${DASHES}BEGIN RSA PRIVATE KEY${DASHES}`
const bodyLine = 'Qm7Tz4Lw9Kp2Xc8V'.repeat(4)

describe('LUM-887 stock classifier', () => {
  it('flags a body left behind the old header-only redaction', () => {
    const stored = `${redactSecret(header)}\n${bodyLine}\n${bodyLine}`
    expect([...classifyStoredText(stored)]).toContain('private-key-body')
    const escaped = `${redactSecret(header)}\\n${bodyLine}`
    expect([...classifyStoredText(escaped)]).toContain('private-key-body')
  })

  it('flags a raw block and the new rule shapes, by id only', () => {
    expect([...classifyStoredText(`${header}\n${bodyLine}`)]).toContain(
      'private-key-block'
    )
    const env = 'DB_PASSWORD=' + 'Qm7Tz4Lw' + '9Kp2'
    expect([...classifyStoredText(env)]).toEqual(['env-assignment'])
  })

  it('LUM-894 stock classifier covers every table and array-stored bodies', () => {
    // Every column the LUM-887 acceptance review listed as unscanned.
    const required: Record<string, string[]> = {
      hookEvent: ['payload', 'toolDetail', 'turnSummary'],
      memory: ['content'],
      session: ['summary', 'runSummary'],
      comment: ['body'],
      taskArtifact: ['content'],
      taskActivity: ['payload'],
      ideaActivity: ['payload'],
      task: ['description', 'claimSnapshot'],
      document: ['content', 'sourceMarkdown'],
      documentRevision: ['content', 'sourceMarkdown'],
      taskSlackContext: ['snapshot'],
      ideaSlackContext: ['snapshot'],
      taskWebLink: ['body'],
      ideaWebLink: ['body'],
      testCaseRun: ['evidence'],
      planRunStageRecord: ['llmRawOutput'],
      prCommentSyncJob: ['payload'],
      boundaryCrossingExplanation: ['note'],
      prSecurityFinding: ['evidence'],
      prSecurityScan: ['huntAudit'],
      boundaryCrossing: ['detail'],
    }
    for (const [delegate, fields] of Object.entries(required)) {
      const scanned = new Set(
        STOCK_TABLES.filter(t => t.delegate === delegate).flatMap(t => t.fields)
      )
      for (const f of fields)
        expect([delegate, f, scanned.has(f)]).toEqual([delegate, f, true])
    }
    // Pruned HookEvent rows keep their extracted columns and are scanned too.
    const pruned = STOCK_TABLES.find(
      t => t.delegate === 'hookEvent' && JSON.stringify(t.where).includes('not')
    )
    expect(pruned?.fields).toEqual(['toolDetail', 'turnSummary'])

    // A body left behind the old header-only redaction, one line per element
    // (a kept structuredPatch hunk), is found.
    const lines = [
      `+${redactSecret(header)}`,
      ...Array.from({ length: 6 }, () => `+${bodyLine}`),
    ]
    expect([...classifyRow([{ structuredPatch: [{ lines }] }])]).toContain(
      'private-key-body'
    )
    // So is a raw key stored the same way.
    expect([...classifyRow([[header, bodyLine, bodyLine]])]).toContain(
      'private-key-block'
    )
    // A rule that existed before LUM-887 counts too: those tables were never
    // redacted at all.
    const aws = 'AKIA' + 'Q7M2Z4LW9KP2XC8V'
    expect([...classifyStoredText(`key ${aws}`)]).toEqual(['aws-access-key-id'])
    // An already-redacted token is not counted again.
    expect(classifyStoredText(`API_KEY=${redactSecret(aws)}`).size).toBe(0)
  })

  it('ignores text the old rules already handled and ordinary text', () => {
    expect(classifyStoredText('export GITHUB_TOKEN=$GH_TOKEN').size).toBe(0)
    expect(classifyStoredText(`${redactSecret(header)}\nnext line`).size).toBe(
      0
    )
  })

  it('walks nested JSON', () => {
    const payload = {
      tool_input: { command: ['PGPASSWORD=' + 'Qm7Tz4Lw9Kp2 psql'] },
    }
    expect(stringsOf(payload)).toHaveLength(1)
    expect([...classifyRow([payload, null])]).toEqual(['env-assignment'])
  })
})
