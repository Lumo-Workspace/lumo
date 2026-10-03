/** @jest-environment node */
import { buildClaimJudgePrompt } from '@/lib/llm/claim-faithfulness-judge-client'

describe('buildClaimJudgePrompt', () => {
  const input = {
    claim: 'only explored the resolver',
    diff: 'diff --git a/lib/resolver.ts ...\n+const x = 1',
    commitSubjects: ['fix: rewrite resolver [LUM-1] (#5)'],
    changedFiles: ['lib/resolver.ts'],
  }
  it('embeds claim, diff, files and the reverse-gate instruction', () => {
    const p = buildClaimJudgePrompt(input)
    expect(p).toContain('only explored the resolver')
    expect(p).toContain('lib/resolver.ts')
    expect(p).toContain('diff --git')
  })
})
