/**
 * LUM-574 — the web delivery card's digest (deriveRunDigest) must apply the
 * SAME meta-reasoning filter as the CLI's selectClaim, so the two surfaces stay
 * same-source and neither leaks the summarizer's meta-reasoning into the claim.
 */
import { deriveRunDigest } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/derive-run-digest'
import type { AgentRunItem } from '@/app/workspace/[workspaceUrl]/types'

function stop(turnSummary: string | null, createdAt: string): AgentRunItem {
  return {
    kind: 'hook',
    type: 'STOP',
    id: createdAt,
    createdAt,
    turnSummary,
  } as unknown as AgentRunItem
}

const LEAKED =
  '我们被要求用一句中文总结一个Claude Code回合内的工具调用序列。给定的输入是用户说的对话内容…'

describe('lum574 deriveRunDigest', () => {
  test('deriveRunDigest filters meta-reasoning lines', () => {
    const digest = deriveRunDigest([
      stop('读了 X，修改 Y', '2026-06-24T00:00:01Z'),
      stop(LEAKED, '2026-06-24T00:00:02Z'),
      stop('运行 npm test，通过', '2026-06-24T00:00:03Z'),
    ])
    expect(digest).toEqual(['读了 X，修改 Y', '运行 npm test，通过'])
    expect(digest.join(' ')).not.toContain('我们被要求')
  })

  test('deriveRunDigest yields an empty digest when every line is meta-reasoning', () => {
    const digest = deriveRunDigest([
      stop(LEAKED, '2026-06-24T00:00:01Z'),
      stop('我们被要求：根据工具调用序列总结', '2026-06-24T00:00:02Z'),
    ])
    expect(digest).toEqual([])
  })
})
