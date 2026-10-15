/** @jest-environment node */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

/**
 * LUM-1151 — the summary-only call: the whole PR's files always, the diff
 * when it fits, the earlier summary as context, all fenced as untrusted;
 * MEMORY_JUDGE tier.
 */
import { generateObject } from 'ai'
import {
  WHOLE_PR_SUMMARY_SYSTEM_PROMPT,
  buildWholePrSummaryPrompt,
  summarizeWholePr,
} from '@/ee/security/llm/pr-summary-client'
import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'

const BASE = {
  files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
  previous: { intent: 'Adds a.', changes: ['One'] },
  tone: '',
  diffTruncated: false,
}

it('fences the diff, the files and the earlier summary', () => {
  const p = buildWholePrSummaryPrompt({
    ...BASE,
    diff: { text: '+const a = 1', notices: ['[notice]'] },
  })
  expect(p.startsWith('<untrusted-pull-request>')).toBe(true)
  expect(p).toContain('- src/a.ts (+3 / -1)')
  expect(p).toContain('<earlier-summary>\nAdds a.\n- One\n</earlier-summary>')
  expect(p).toContain('<diff>\n[notice]\n+const a = 1\n</diff>')
  expect(p).not.toContain('too large')
  expect(
    buildWholePrSummaryPrompt({ ...BASE, diff: null, moreFiles: 4 })
  ).toContain('- … and 4 more files not listed')
})

it('without the diff says so; a tone goes after the fence', () => {
  const p = buildWholePrSummaryPrompt({ ...BASE, diff: null, tone: 'Be terse' })
  expect(p).not.toContain('<diff>')
  expect(p).toContain('The diff is too large to show')
  expect(p.indexOf('Be terse')).toBeGreaterThan(
    p.indexOf('</untrusted-pull-request>')
  )
})

it('calls the MEMORY_JUDGE tier with the whole-PR instruction', async () => {
  ;(generateObject as jest.Mock).mockResolvedValue({
    object: { intent: 'Whole.', changes: [] },
  })
  await expect(summarizeWholePr({ ...BASE, diff: null })).resolves.toEqual({
    intent: 'Whole.',
    changes: [],
  })
  const call = (generateObject as jest.Mock).mock.calls[0]![0]
  expect(call.model).toEqual({ id: MEMORY_JUDGE_MODEL })
  expect(call.system).toBe(WHOLE_PR_SUMMARY_SYSTEM_PROMPT)
  expect(call.system).toContain('not only the most recent commit')
})
