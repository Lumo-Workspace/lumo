import {
  contentSummaryService,
  SUMMARY_PROMPTS,
} from '@/lib/services/content-summary.service'

describe('contentSummaryService', () => {
  it('exposes a prompt template per kind', () => {
    expect(Object.keys(SUMMARY_PROMPTS).sort()).toEqual([
      'artifact',
      'comments',
      'document',
      'slack',
    ])
  })

  it('returns empty string for blank input without calling the model', async () => {
    const out = await contentSummaryService.summarize('   ', 'slack', {
      workspaceId: 'ws1',
    })
    expect(out).toBe('')
  })

  it('does NOT statically import @ai-sdk/gateway (jest TransformStream trap)', () => {
    const src = require('fs').readFileSync(
      require('path').join(
        process.cwd(),
        'lib/services/content-summary.service.ts'
      ),
      'utf8'
    )
    expect(src).not.toMatch(/^import .*(@ai-sdk\/gateway|@\/lib\/ai\/gateway)/m)
    expect(src).toMatch(/await import\(/)
  })
})
