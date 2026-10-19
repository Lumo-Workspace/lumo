/**
 * @jest-environment node
 *
 * LUM-428 — output-token budget for agent-facing CLI commands. The two
 * `it(...)` names below are wired into the task's MACHINE acceptance criteria;
 * keep them byte-stable.
 */
import {
  estimateTokens,
  OUTPUT_TOKEN_BUDGET,
  truncateUnitsToBudget,
  capRenderedOutput,
} from '../../../../shared/src/output-budget'
import { formatCommentThread } from '../../../../cli/src/commands/task-comment-list'
import {
  formatShowOutput,
  selectDocShowOutput,
} from '../../../../cli/src/commands/doc-show'
import { formatTaskContextMarkdown } from '../../../../cli/src/commands/task-context'
import {
  extractSection,
  findSection,
} from '../../../../cli/src/lib/markdown-sections'
import { formatUnifiedDiff } from '../../../../cli/src/lib/unified-diff'

const POINTER = 'not shown (output capped at'
const NOW = new Date('2026-06-10T00:00:00Z')

function bigParagraph(chars: number): string {
  return 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars)
}

describe('output-budget primitive', () => {
  it('leaves output under budget untouched', () => {
    const units = ['a', 'b', 'c']
    const r = truncateUnitsToBudget({
      units,
      unitNoun: 'comments',
      fetchHint: 'x',
    })
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('a\n\nb\n\nc')
    expect(r.omittedUnits).toBe(0)
  })

  it('truncateUnitsToBudget caps to the budget, keeps ≥1 unit, appends a pointer', () => {
    const units = Array.from(
      { length: 4000 },
      (_, i) => `comment ${i}: ${bigParagraph(200)}`
    )
    const r = truncateUnitsToBudget({
      units,
      unitNoun: 'comments',
      fetchHint: 'lumo task comments list LUM-1 --full',
    })
    expect(r.truncated).toBe(true)
    expect(r.shownUnits).toBeGreaterThan(0)
    expect(r.omittedUnits).toBeGreaterThan(0)
    expect(r.shownUnits + r.omittedUnits).toBe(units.length)
    expect(estimateTokens(r.text)).toBeLessThanOrEqual(OUTPUT_TOKEN_BUDGET)
    expect(r.text).toContain(POINTER)
    expect(r.text).toContain('lumo task comments list LUM-1 --full')
  })

  it('capRenderedOutput fills the budget even for one very long line (no wholesale drop)', () => {
    const oneHugeLine = bigParagraph(OUTPUT_TOKEN_BUDGET * 8) // 2× the budget, no newlines
    const r = capRenderedOutput(oneHugeLine, { fetchHint: 'see --raw' })
    expect(r.truncated).toBe(true)
    expect(estimateTokens(r.text)).toBeLessThanOrEqual(OUTPUT_TOKEN_BUDGET)
    // The body must be substantial — close to the budget — not a near-empty stub.
    expect(estimateTokens(r.text)).toBeGreaterThan(OUTPUT_TOKEN_BUDGET * 0.8)
    expect(r.text).toContain(POINTER)
  })

  it('agent-facing command output is truncated to the budget with a fetch-more pointer', () => {
    // 1) task comments list — an aggregate of repeatable units.
    const comments = Array.from({ length: 600 }, (_, i) => ({
      id: `c${i}`,
      authorActorId: `user_${i % 5}`,
      body: `<p>${bigParagraph(400)}</p>`,
      createdAt: '2026-06-10T00:00:00Z',
    }))
    const thread = formatCommentThread(comments, { identifier: 'LUM-428' })
    expect(estimateTokens(thread)).toBeLessThanOrEqual(OUTPUT_TOKEN_BUDGET)
    expect(thread).toContain(POINTER)
    expect(thread).toContain('lumo task show LUM-428 --comments --full')
    // --full is the honest escape hatch the pointer advertises: no cap.
    const full = formatCommentThread(comments, {
      identifier: 'LUM-428',
      full: true,
    })
    expect(estimateTokens(full)).toBeGreaterThan(OUTPUT_TOKEN_BUDGET)
    expect(full).not.toContain(POINTER)

    // 2) doc show (default render) — a single big body; pointer routes to --raw/--section.
    const docOut = formatShowOutput({
      id: 'cmdoc',
      title: 'Spec',
      scope: 'WORKSPACE',
      projectName: 'Lumo',
      createdAt: '2026-06-10T00:00:00Z',
      updatedAt: '2026-06-10T00:00:00Z',
      revision: 3,
      mentionedTasks: [],
      bodyMarkdown: bigParagraph(OUTPUT_TOKEN_BUDGET * 6),
    })
    expect(estimateTokens(docOut)).toBeLessThanOrEqual(OUTPUT_TOKEN_BUDGET)
    expect(docOut).toContain(POINTER)
    expect(docOut).toContain('--raw')

    // 3) task context — the memory-rich handoff; pointer routes to sub-commands.
    const ctx = formatTaskContextMarkdown(
      {
        task: {
          identifier: 'LUM-428',
          title: 't',
          status: 'TODO',
          description: 'd',
        },
        memorySection: bigParagraph(OUTPUT_TOKEN_BUDGET * 6),
        sessions: [],
      },
      NOW
    )
    expect(estimateTokens(ctx)).toBeLessThanOrEqual(OUTPUT_TOKEN_BUDGET)
    expect(ctx).toContain(POINTER)
    expect(ctx).toContain('lumo task show LUM-428 --comments --full')
  })

  it('doc show --raw/--section and doc diff stay byte-faithful on a large doc', () => {
    // A doc far larger than the budget: every byte-faithful read must stay full.
    const bigSection = bigParagraph(OUTPUT_TOKEN_BUDGET * 6)
    const source = `# Doc\n\nintro\n\n## Big\n\n${bigSection}\n\n## After\n\ntail\n`
    expect(estimateTokens(source)).toBeGreaterThan(OUTPUT_TOKEN_BUDGET)

    // --raw: byte-identical, no header, NEVER capped.
    const raw = selectDocShowOutput(
      { id: 'd', title: 'D', sourceMarkdown: source },
      { raw: true }
    )
    expect(raw.kind).toBe('bytes')
    if (raw.kind === 'bytes') {
      expect(raw.text).toBe(source)
      expect(raw.text).not.toContain(POINTER)
    }

    // --section: byte-identical slice of the addressed section, NEVER capped.
    const section = selectDocShowOutput(
      { id: 'd', title: 'D', sourceMarkdown: source },
      { section: '## Big' }
    )
    expect(section.kind).toBe('bytes')
    const match = findSection(source, '## Big')
    expect(match.kind).toBe('found')
    if (section.kind === 'bytes' && match.kind === 'found') {
      expect(section.text).toBe(extractSection(source, match.section))
      expect(section.text).toContain(bigSection)
      expect(section.text).not.toContain(POINTER)
      expect(estimateTokens(section.text)).toBeGreaterThan(OUTPUT_TOKEN_BUDGET)
    }

    // doc diff: a late difference in a huge doc still surfaces — not truncated.
    const common = bigParagraph(OUTPUT_TOKEN_BUDGET * 6)
    const diff = formatUnifiedDiff(
      `${common}\nLINE-A`,
      `${common}\nLINE-B`,
      'remote',
      'local'
    )
    expect(diff).toContain('LINE-A')
    expect(diff).toContain('LINE-B')
    expect(diff).not.toContain(POINTER)
  })
})
