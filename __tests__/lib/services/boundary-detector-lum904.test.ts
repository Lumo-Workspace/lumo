/**
 * @jest-environment node
 *
 * LUM-904 — boundary-detector leftovers from the LUM-899 / LUM-900 review:
 * checkout root from the CLI (session cwd above the checkout), `..` in paths,
 * NotebookEdit writes, a redacted systemExplanation, and clipped-detail
 * recognition after the LUM-898 re-redaction. Credential-shaped values are
 * assembled at runtime (no literal).
 */
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  CHECKOUT_RELATIVE_PATH_FIELD,
  detectCrossings,
  isClippedDetail,
} from '@/lib/services/boundary-detector.service'
import { extractFilePath } from '@/lib/services/hook-event.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { rejudgeRow } from '@/lib/boundary-crossing/rejudge'
import { augmentBodyWithWrittenPathIgnored } from '@/cli/src/lib/hook-runner'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { boundaryCrossing: { update: jest.fn() } },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const stripeLive = 'sk_' + 'live_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6'
const githubToken = 'ghp' + '_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7Ab'
const content = `const k = "${stripeLive}"`

const write = (filePath: string, extra: Record<string, unknown> = {}) => ({
  toolName: 'Write',
  filePath,
  payload: { tool_input: { file_path: filePath, content }, ...extra },
})

const secrets = (filePath: string, extra: Record<string, unknown> = {}) =>
  detectCrossings(write(filePath, extra)).filter(
    c => c.category === 'HARDCODED_SECRET'
  )

/** One crossing, blocking: not advisory and not LOW. */
const isBlocking = (filePath: string, extra: Record<string, unknown> = {}) => {
  const hits = secrets(filePath, extra)
  return (
    hits.length === 1 &&
    hits[0]!.advisory !== true &&
    hits[0]!.severity !== 'LOW'
  )
}

describe('LUM-904 checkout root', () => {
  it('LUM-904 checkout root reported by the CLI beats an ancestor session cwd', () => {
    const rows: Array<[string, string, string]> = [
      ['/Users/me', '/Users/me/docs/app/lib/stripe.ts', 'lib/stripe.ts'],
      ['/home/ci', '/home/ci/tests/app/lib/x.ts', 'lib/x.ts'],
    ]
    for (const [cwd, file, rel] of rows) {
      expect({ file, blocking: isBlocking(file, { cwd }) }).toEqual({
        file,
        // An old client (no reported path) still misreads the checkout's
        // location — documented, only the CLI knows the root.
        blocking: false,
      })
      expect({
        file,
        blocking: isBlocking(file, {
          cwd,
          [CHECKOUT_RELATIVE_PATH_FIELD]: rel,
        }),
      }).toEqual({ file, blocking: true })
    }
    // A real test file inside that checkout is still downgraded.
    const inTests = secrets('/Users/me/docs/app/__tests__/pay.test.ts', {
      cwd: '/Users/me',
      [CHECKOUT_RELATIVE_PATH_FIELD]: '__tests__/pay.test.ts',
    })
    expect(inTests).toHaveLength(1)
    expect(inTests[0]!.advisory).toBe(true)
  })

  it('LUM-904 checkout root end to end from a real git checkout', () => {
    const home = mkdtempSync(join(tmpdir(), 'lum904-e2e-'))
    try {
      const app = join(home, 'docs', 'app')
      mkdirSync(join(app, 'lib'), { recursive: true })
      expect(
        spawnSync('git', ['init', '-q'], { cwd: app, stdio: 'ignore' }).status
      ).toBe(0)
      const file = join(app, 'lib', 'stripe.ts')
      writeFileSync(file, content)
      // The hook body as Claude Code sends it from a session started in ~.
      const body = augmentBodyWithWrittenPathIgnored(
        'post-tool-use',
        JSON.stringify({
          cwd: home,
          tool_name: 'Write',
          tool_input: { file_path: file, content },
        })
      )
      const payload = JSON.parse(body)
      const hits = detectCrossings({
        toolName: 'Write',
        filePath: extractFilePath(payload),
        payload,
      }).filter(c => c.category === 'HARDCODED_SECRET')
      expect(hits).toHaveLength(1)
      expect(hits[0]!.advisory).toBeUndefined()
      expect(hits[0]!.severity).toBe('HIGH')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('LUM-904 dot-dot', () => {
  it('LUM-904 dot-dot segments are normalized before the path downgrade', () => {
    // Control: a real doc path inside the checkout is downgraded.
    expect(isBlocking('/repo/docs/x.ts', { cwd: '/repo' })).toBe(false)
    // `/repo/../docs/x.ts` is `/docs/x.ts` — outside the checkout.
    expect(isBlocking('/repo/../docs/x.ts', { cwd: '/repo' })).toBe(true)
    expect(isBlocking('/repo/./lib/../../docs/x.ts', { cwd: '/repo' })).toBe(
      true
    )
    // A `..` inside the checkout still lands inside it.
    expect(isBlocking('/repo/lib/../docs/x.ts', { cwd: '/repo' })).toBe(false)
    expect(isBlocking('/repo/lib/../src/x.ts', { cwd: '/repo/' })).toBe(true)
    // A relative path climbing out of its start is not downgraded on a guess.
    expect(isBlocking('../docs/x.ts')).toBe(true)
    expect(isBlocking('./docs/x.ts')).toBe(false)
  })

  it('LUM-904 dot-dot or mismatched reported paths are ignored', () => {
    const file = '/repo/lib/x.ts'
    for (const reported of [
      'docs/x.ts', // not the written file
      '../docs/x.ts', // climbs out
      'lib/../docs/x.ts', // normalizes to a different file
      '/repo/docs/x.ts', // absolute
      '',
      42,
    ]) {
      expect({
        reported,
        blocking: isBlocking(file, {
          cwd: '/repo',
          [CHECKOUT_RELATIVE_PATH_FIELD]: reported,
        }),
      }).toEqual({ reported, blocking: true })
    }
    // A matching one on a segment boundary is honoured (and `.`-normalized).
    expect(
      isBlocking('/repo/docs/x.ts', {
        cwd: '/elsewhere',
        [CHECKOUT_RELATIVE_PATH_FIELD]: './docs/x.ts',
      })
    ).toBe(false)
    // `ocs/x.ts` is a suffix of the string but not of the path segments.
    expect(
      isBlocking('/repo/docs/x.ts', {
        cwd: '/elsewhere',
        [CHECKOUT_RELATIVE_PATH_FIELD]: 'ocs/x.ts',
      })
    ).toBe(true)
  })
})

describe('LUM-904 notebook', () => {
  it('LUM-904 notebook cell write with a live key is a secret crossing', () => {
    const nb = '/repo/analysis/billing.ipynb'
    const payload = {
      cwd: '/repo',
      tool_name: 'NotebookEdit',
      tool_input: {
        notebook_path: nb,
        cell_id: 'c1',
        edit_mode: 'replace',
        new_source: `stripe.api_key = "${stripeLive}"`,
      },
    }
    expect(extractFilePath(payload)).toBe(nb)
    const hits = detectCrossings({
      toolName: 'NotebookEdit',
      filePath: extractFilePath(payload),
      payload,
    }).filter(c => c.category === 'HARDCODED_SECRET')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.target).toBe(nb)
    expect(hits[0]!.detail).toContain(nb)
    expect(hits[0]!.detail).not.toContain(stripeLive)
    expect(hits[0]!.advisory).toBeUndefined()
    expect(hits[0]!.severity).toBe('HIGH')
  })
})

describe('LUM-904 system explanation', () => {
  it('LUM-904 system explanation is stored redacted', async () => {
    const update = prisma.boundaryCrossing.update as jest.Mock
    update.mockResolvedValue({ id: 'bc-1', systemExplanation: 'x' })
    const text = `The agent ran git push with ${githubToken} inline.`
    await boundaryCrossingRepository.setSystemExplanation('bc-1', text)
    const stored = update.mock.calls[0]![0].data.systemExplanation as string
    expect(stored).not.toContain(githubToken)
    expect(stored).toBe(redactForStorage(text).text)
    expect(stored).toContain('The agent ran git push with ')
  })
})

describe('LUM-904 clipped detail', () => {
  it('LUM-904 clipped detail stays truncated after the backfill re-redaction', () => {
    // A pre-LUM-900 clipped detail: raw command cut at 200 chars + `…`.
    const command = `curl -H "Authorization: token ${githubToken}" ${'https://api.example.com/v1/items?page=1&per_page=100 '.repeat(5)}`
    const clipped = `${command.slice(0, 200)}…`
    expect(clipped).toHaveLength(201)
    // What the LUM-898 stock backfill writes back.
    const reredacted = redactForStorage(clipped).text
    expect(reredacted).not.toContain(githubToken)
    expect(reredacted.length).not.toBe(201)
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
    // A whole (unclipped) detail is still judgeable.
    expect(isClippedDetail('git push origin feature')).toBe(false)
  })
})
