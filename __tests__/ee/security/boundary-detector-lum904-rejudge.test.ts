/**
 * LUM-904 — plugin half of __tests__/lib/services/boundary-detector-lum904.test.ts
 * (split in LUM-1065): with the security plugin's rule matcher installed, a
 * pre-LUM-900 clipped detail (re-redacted by the LUM-898 backfill) is left
 * open as TRUNCATED by the policy-rule re-judge; with the full hook command
 * on record it is judged as before.
 */
import { isClippedDetail } from '@/lib/services/boundary-detector.service'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { rejudgeRow } from '@/lib/boundary-crossing/rejudge'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

const githubToken = 'ghp' + '_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7Ab'

it('LUM-904 clipped detail stays truncated after the backfill re-redaction', () => {
  const command = `curl -H "Authorization: token ${githubToken}" ${'https://api.example.com/v1/items?page=1&per_page=100 '.repeat(5)}`
  const reredacted = redactForStorage(`${command.slice(0, 200)}…`).text
  expect(isClippedDetail(reredacted)).toBe(true)

  const row = {
    id: 'bc-1',
    taskId: 't1',
    projectId: 'p1',
    policyRuleRef: 'r1',
    policyRuleText: null,
    detail: reredacted,
    command: null,
  }
  expect(rejudgeRow(row, []).verdict).toBe('TRUNCATED')
  // With the full hook command on record it is judged as before.
  expect(rejudgeRow({ ...row, command }, []).verdict).not.toBe('TRUNCATED')
})
