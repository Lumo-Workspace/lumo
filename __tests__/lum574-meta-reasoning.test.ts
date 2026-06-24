/**
 * LUM-574 — turn-digest meta-reasoning leak.
 *
 * The per-turn summarizer occasionally emits the model's own meta-reasoning
 * (its out-loud "how do I summarize this?" preamble) instead of a summary, and
 * the claim box's DIGEST fallback then surfaces that raw text verbatim
 * (observed live in LUM-571 / LUM-540 / LUM-582). This locks the two-layer fix:
 * a capture-layer guard that refuses to store meta-reasoning, and a read-layer
 * filter that strips any already-stored meta-reasoning out of the digest.
 */
import {
  isMetaReasoning,
  cleanTurnSummary,
  filterMetaReasoning,
} from '@/lib/services/meta-reasoning'
import { selectClaim } from '@/lib/services/task-claim'

// Real leaked strings observed in the LUM-571 / LUM-540 / LUM-582 claim boxes.
const LEAKED = [
  '我们被要求总结一个Agent的回合动作。给出的是一个时间戳和一段对话文本，看起来是…需要基于事件本身总结…',
  '我们被要求用一句中文总结一个Claude Code回合内的工具调用序列。给定的输入是用户说的对话内容，不是工具调用序列。可能是误解…',
  '我们被要求：根据Claude Code回合内的工具调用序列…总结…',
]

// Legitimate one-line summaries the summarizer is supposed to produce
// (verb-first, naming files/commands — see the SYSTEM_PROMPT). "分析 X" and
// "查阅 X" are explicitly sanctioned by the prompt and must NOT be flagged.
const LEGIT = [
  '读了 task-claim.ts，修改 selectClaim 过滤元推理',
  '运行 npm test，3 个用例通过',
  '查阅 turn-summary.service.ts 的 cleanSummary 实现',
  '分析 digest 回退路径，定位泄漏根因',
  '新增 meta-reasoning.ts，导出 isMetaReasoning',
]

describe('lum574 meta-reasoning detector', () => {
  test('isMetaReasoning flags every leaked summarizer preamble', () => {
    for (const s of LEAKED) {
      expect(isMetaReasoning(s)).toBe(true)
    }
  })

  test('isMetaReasoning allows legitimate action summaries', () => {
    for (const s of LEGIT) {
      expect(isMetaReasoning(s)).toBe(false)
    }
  })

  test('isMetaReasoning ignores surrounding whitespace and wrapping quotes', () => {
    expect(isMetaReasoning('  「我们被要求总结这一回合」  ')).toBe(true)
    expect(isMetaReasoning('')).toBe(false)
  })
})

describe('lum574 capture guard cleanTurnSummary', () => {
  test('cleanTurnSummary discards meta-reasoning output', () => {
    for (const s of LEAKED) {
      expect(cleanTurnSummary(s)).toBeNull()
    }
  })

  test('cleanTurnSummary keeps and normalizes a legitimate summary', () => {
    expect(cleanTurnSummary('  读了 X，修改 Y  ')).toBe('读了 X，修改 Y')
    expect(cleanTurnSummary('"运行 npm test"')).toBe('运行 npm test')
    expect(cleanTurnSummary('   ')).toBeNull()
  })

  test('cleanTurnSummary truncates an over-long legitimate summary', () => {
    const long = '修改 ' + 'X'.repeat(300)
    const out = cleanTurnSummary(long)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThanOrEqual(140)
    expect(out!.endsWith('…')).toBe(true)
  })
})

describe('lum574 selectClaim digest filtering', () => {
  test('selectClaim filters meta-reasoning from the digest', () => {
    const claim = selectClaim({
      runSummary: null,
      turnSummaries: ['读了 X，修改 Y', LEAKED[0]!],
    })
    expect(claim.source).toBe('DIGEST')
    expect(claim.text).toBe('读了 X，修改 Y')
    expect(claim.text).not.toContain('我们被要求')
  })

  test('selectClaim returns a pending claim when the digest is all meta-reasoning', () => {
    const claim = selectClaim({ runSummary: null, turnSummaries: LEAKED })
    expect(claim).toEqual({ text: null, source: null })
  })

  test('selectClaim leaves a RUN_SUMMARY untouched even with dirty turn notes', () => {
    const claim = selectClaim({ runSummary: '交付了 X', turnSummaries: LEAKED })
    expect(claim).toEqual({ text: '交付了 X', source: 'RUN_SUMMARY' })
  })
})

describe('lum574 filterMetaReasoning helper', () => {
  test('filterMetaReasoning drops empty and meta lines and trims the rest', () => {
    expect(
      filterMetaReasoning(['  读了 X  ', '', LEAKED[1]!, '运行 test'])
    ).toEqual(['读了 X', '运行 test'])
  })
})
