/**
 * @jest-environment node
 *
 * LUM-785 — the managed scan's semgrep step ships Lumo's own rules into the
 * sandbox and loads them next to the registry packs; the YAML it ships is
 * byte-identical to the file `semgrep --test` runs against.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  ...jest.requireActual('@/lib/integrations/vercel-sandbox'),
  createRepoSandbox: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { findStagesById: jest.fn() },
}))

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRepoSandbox } from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import {
  securityManagedScanService,
  SEMGREP_CONFIGS,
} from '@/lib/services/security-managed-scan.service'
import {
  LLM_SEMGREP_RULES_YAML,
  SEMGREP_CUSTOM_RULES_EOF,
  SEMGREP_CUSTOM_RULES_PATH,
} from '@/lib/security-scan/semgrep-rules'

const JOB = {
  scanId: 's1',
  pr: { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 },
  headSha: 'a'.repeat(40),
  huntWanted: false,
}
const EMPTY_SARIF = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'x', rules: [] } }, results: [] }],
})

function fakeSandbox() {
  return {
    cwd: '/vercel',
    run: jest.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    readFile: jest.fn(async () => Buffer.from(EMPTY_SARIF)),
    stop: jest.fn(async () => undefined),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(getGithubInstallationToken as jest.Mock).mockResolvedValue('tok')
  ;(fetchPrDiff as jest.Mock).mockResolvedValue(
    [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +1,1 @@',
      '+const x = 1',
    ].join('\n')
  )
  ;(prSecurityScanRepository.findStagesById as jest.Mock).mockResolvedValue({
    external: 'PENDING',
    supplyChain: 'PENDING',
  })
})

describe('LUM-785 semgrep custom rules', () => {
  it('writes the rules into the checkout root, loads them first via --config next to the registry packs, and removes them after the run', async () => {
    const sb = fakeSandbox()
    ;(createRepoSandbox as jest.Mock).mockResolvedValue(sb)
    await securityManagedScanService.scanRepository(JOB)
    const scripts = sb.run.mock.calls.map(c =>
      ((c as unknown as [string, string[]])[1] ?? []).join(' ')
    )
    const semgrep = scripts.find(s => s.includes('semgrep scan'))
    expect(semgrep).toBeDefined()
    // The heredoc carries the YAML verbatim, quoted so `$V` never expands.
    expect(semgrep).toContain(
      `cat > ${SEMGREP_CUSTOM_RULES_PATH} <<'${SEMGREP_CUSTOM_RULES_EOF}'\n`
    )
    expect(semgrep).toContain(LLM_SEMGREP_RULES_YAML.trimEnd())
    expect(semgrep).toContain(`\n${SEMGREP_CUSTOM_RULES_EOF}\n`)
    // Loaded FIRST, then every registry pack, then the SARIF output.
    expect(semgrep).toContain(
      `semgrep scan --config ${SEMGREP_CUSTOM_RULES_PATH} ${SEMGREP_CONFIGS.map(c => `--config ${c}`).join(' ')} --sarif --output /tmp/semgrep.sarif --metrics=off`
    )
    // Cleanup keeps semgrep's own exit code (1 = findings).
    expect(semgrep).toContain(
      `|| code=$?\nrm -f ${SEMGREP_CUSTOM_RULES_PATH}\nexit $code`
    )
    // The rules file is a checkout-root dotfile — not /tmp — so the rule ids
    // stay `lumo.llm.*` (semgrep prefixes local config ids with their dir).
    expect(SEMGREP_CUSTOM_RULES_PATH).toMatch(/^\.[^/]+\.ya?ml$/)
    // Every tool still runs from the clone directory.
    for (const call of sb.run.mock.calls) {
      expect((call as unknown as [string, string[], unknown])[2]).toEqual({
        cwd: '/vercel/r',
      })
    }
  })

  it('ships a YAML byte-identical to security/semgrep-rules/llm.yaml', () => {
    const onDisk = readFileSync(
      resolve(process.cwd(), 'security/semgrep-rules/llm.yaml'),
      'utf8'
    )
    expect(LLM_SEMGREP_RULES_YAML).toBe(onDisk)
    // The heredoc terminator must never occur inside the body.
    expect(onDisk).not.toContain(SEMGREP_CUSTOM_RULES_EOF)
    // Every rule the pack ships, with the metadata the SARIF normalisation
    // turns into severity and externalRef. LUM-785 shipped the first three;
    // LUM-794 added the three agent-loop-budget rules.
    const ruleIds = [
      'lumo.llm.untrusted-input-in-prompt',
      'lumo.llm.untrusted-input-in-ai-sdk-prompt',
      'lumo.llm.system-prompt-from-runtime-value',
      'lumo.llm.agent-loop-no-step-cap',
      'lumo.llm.agent-loop-non-step-stop',
      'lumo.llm.agent-step-cap-from-request',
    ]
    for (const id of ruleIds) {
      expect(onDisk).toContain(`- id: ${id}`)
      // …and it reaches the sandbox, which is what actually loads them.
      expect(LLM_SEMGREP_RULES_YAML).toContain(`- id: ${id}`)
    }
    // Every rule carries the two metadata keys, and no rule is left out of
    // this list: the counts are the pack size, not a sample of it.
    // Prettier may re-quote the YAML scalars; either quote style is fine.
    expect((onDisk.match(/^  - id: /gm) ?? []).length).toBe(ruleIds.length)
    expect((onDisk.match(/security-severity: ['"]/g) ?? []).length).toBe(
      ruleIds.length
    )
    expect((onDisk.match(/\n\s+source: https:\/\//g) ?? []).length).toBe(
      ruleIds.length
    )
  })
})
