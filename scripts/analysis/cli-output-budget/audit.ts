/**
 * LUM-428 — output-token-budget audit for agent-facing CLI commands
 * (read-first, measure-first; the report is the deliverable, lum392/lum427 mode).
 *
 * Anthropic's "Writing effective tools for AI agents" frames a tool response as
 * a contract that spends from the agent's context budget, and notes Claude Code
 * truncates a tool result to 25,000 tokens. Lumo's agent-facing commands print
 * straight into that budget — `task context`, `doc show`, `task comments list`,
 * `task status`, `task lineage`. The session-start
 * INJECTION path already allocates a budget (LUM-402); the command-stdout path
 * never had one audited.
 *
 * This script enumerates those commands, drives each real (pure) formatter with
 * a realistic-large fixture and an extreme fixture, and reports per command:
 *   - tokens it would emit UNCAPPED at a realistic-large input,
 *   - tokens the agent actually receives (post-cap),
 *   - whether it now has a hard output ceiling,
 *   - and FLAGS the ones whose realistic output blows the budget with no cap.
 *
 * Measure-first verdict (do NOT one-size-fits-all — CLAUDE-plan guidance):
 *   - FLAGGED + capped in v1: `task comments list`, `task context`,
 *     `doc show` (default render). These genuinely overflow at realistic input.
 *   - Not flagged: `task lineage` / `task status` — structurally bounded by
 *     how many fragments / next actions a task has; measured
 *     well under budget at realistic input, so capping them is deferred.
 *   - EXEMPT (must never be capped): the byte-faithful reads `doc show --raw`,
 *     `doc show --section`, `doc diff` — they are legal `doc patch` edit bases
 *     (LUM-408/409); truncating them would corrupt the edit base.
 */
import {
  estimateTokens,
  OUTPUT_TOKEN_BUDGET,
} from '../../../shared/src/output-budget'
import {
  formatCommentThread,
  type CommentNode,
} from '../../../cli/src/commands/task-comment-list'
import {
  formatShowOutput,
  selectDocShowOutput,
  type DocShowOutput,
} from '../../../cli/src/commands/doc-show'
import { formatTaskContextMarkdown } from '../../../cli/src/commands/task-context'
import {
  formatLineageMarkdown,
  type LineageResponse,
} from '../../../cli/src/commands/task-lineage'
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../../cli/src/commands/task-status'
import { formatUnifiedDiff } from '../../../cli/src/lib/unified-diff'

export const BUDGET = OUTPUT_TOKEN_BUDGET
/** Deterministic clock for the context formatter ("X ago" phrasing). */
const NOW = new Date('2026-06-10T00:00:00Z')

export type CommandKind = 'render-aggregate' | 'byte-faithful'
export type Scale = 'realistic' | 'extreme'

// ── Fixture builders ─────────────────────────────────────────────────────────

function lorem(chars: number): string {
  return 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars)
}

function makeComments(n: number, bodyChars: number): CommentNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    authorActorId: `user_${i % 7}`,
    body: `<p>${lorem(bodyChars)}</p>`,
    createdAt: '2026-06-10T00:00:00Z',
  }))
}

function makeLineage(nFragments: number): LineageResponse {
  const groups = []
  const perGroup = Math.max(1, Math.ceil(nFragments / 4))
  let remaining = nFragments
  let g = 0
  while (remaining > 0) {
    const take = Math.min(perGroup, remaining)
    groups.push({
      label: `Session cmp${g}`,
      includedAt: '2026-06-10T00:00:00Z',
      cost: {
        total: 12000,
        input: 4000,
        output: 2000,
        cacheRead: 4000,
        cacheCreation: 2000,
        loopCount: 6,
      },
      fragments: Array.from({ length: take }, (_, i) => ({
        fragmentType: 'MEMORY',
        sourceLabel: `mem fragment ${g}-${i} about layered architecture`,
        outcome: 'MERGED' as const,
        used: i % 2 === 0 ? true : null,
        // LUM-521: longest per-fragment tag (INDEX not-pulled) → conservative
        // for the output-byte budget audit.
        disclosure: 'INDEX' as const,
        pulled: false,
      })),
    })
    remaining -= take
    g += 1
  }
  return {
    task: { identifier: 'LUM-428', title: 'audit', status: 'TODO' },
    totals: {
      runCount: groups.length,
      fragmentCount: nFragments,
      edgeCount: nFragments,
      tokens: {
        input: 4000,
        output: 2000,
        cacheRead: 4000,
        cacheCreation: 2000,
        total: 12000,
      },
      loopCount: 6,
      outcomes: { MERGED: nFragments, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
      // LUM-521 disclosure funnel (edge-level): all INDEX, none pulled, ~half used.
      funnel: {
        impressions: nFragments,
        index: nFragments,
        pulled: 0,
        used: Math.ceil(nFragments / 2),
      },
      topOperations: [],
    },
    groups,
  }
}

function makeStatus(n: number): TaskStatusResponse {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-428', title: 'audit', status: 'TODO' },
    nextActions: Array.from({ length: n }, (_, i) => ({
      kind: 'TEST_CASE' as const,
      statement: `Test case ${i}: ${lorem(120)}`,
      command: `npx tsx scripts/jest-t.ts 'case ${i}' a/b.test.ts`,
      advisory: true as const,
    })),
  }
}

function makeDocWithSection(bodyChars: number): string {
  return `# Doc\n\nintro\n\n## Big\n\n${lorem(bodyChars)}\n\n## After\n\ntail\n`
}

function bytesText(out: DocShowOutput): string {
  return out.kind === 'bytes' ? out.text : `__unexpected:${out.kind}__`
}

// ── Command probes ───────────────────────────────────────────────────────────

interface CommandProbe {
  command: string
  kind: CommandKind
  /** What the command would emit with NO output cap, at the given scale. */
  uncapped: (scale: Scale) => string
  /** What the agent actually receives (post-cap), at the given scale. */
  actual: (scale: Scale) => string
}

const SIZES = {
  comments: { realistic: 240, extreme: 2000, body: 600 },
  doc: { realistic: 160_000, extreme: 1_000_000 },
  context: { realistic: 160_000, extreme: 1_000_000 },
  lineage: { realistic: 120, extreme: 5000 },
  status: { realistic: 25, extreme: 5000 },
  byteFaithful: 200_000,
} as const

export const PROBES: CommandProbe[] = [
  {
    command: 'lumo task comments list <id>',
    kind: 'render-aggregate',
    uncapped: s =>
      formatCommentThread(
        makeComments(SIZES.comments[s], SIZES.comments.body),
        {
          full: true,
        }
      ),
    actual: s =>
      formatCommentThread(
        makeComments(SIZES.comments[s], SIZES.comments.body),
        {
          identifier: 'LUM-428',
        }
      ),
  },
  {
    command: 'lumo doc show <doc>',
    kind: 'render-aggregate',
    // The body dominates; the ~8-line header is negligible. Uncapped proxy = body.
    uncapped: s => lorem(SIZES.doc[s]),
    actual: s =>
      formatShowOutput({
        id: 'cmdoc',
        title: 'Spec',
        scope: 'WORKSPACE',
        projectName: 'Lumo',
        createdAt: '2026-06-10T00:00:00Z',
        updatedAt: '2026-06-10T00:00:00Z',
        revision: 3,
        mentionedTasks: [],
        bodyMarkdown: lorem(SIZES.doc[s]),
      }),
  },
  {
    command: 'lumo task context <id>',
    kind: 'render-aggregate',
    uncapped: s => lorem(SIZES.context[s]),
    actual: s =>
      formatTaskContextMarkdown(
        {
          task: {
            identifier: 'LUM-428',
            title: 'audit',
            status: 'TODO',
            description: 'd',
          },
          memorySection: lorem(SIZES.context[s]),
          sessions: [],
        },
        NOW
      ),
  },
  {
    command: 'lumo task lineage <id>',
    kind: 'render-aggregate',
    uncapped: s => formatLineageMarkdown(makeLineage(SIZES.lineage[s])),
    actual: s => formatLineageMarkdown(makeLineage(SIZES.lineage[s])),
  },
  {
    command: 'lumo task status <id>',
    kind: 'render-aggregate',
    uncapped: s => formatTaskStatus(makeStatus(SIZES.status[s])),
    actual: s => formatTaskStatus(makeStatus(SIZES.status[s])),
  },
  {
    command: 'lumo doc show <doc> --raw',
    kind: 'byte-faithful',
    uncapped: () =>
      bytesText(
        selectDocShowOutput(
          { id: 'd', title: 'D', sourceMarkdown: lorem(SIZES.byteFaithful) },
          { raw: true }
        )
      ),
    actual: () =>
      bytesText(
        selectDocShowOutput(
          { id: 'd', title: 'D', sourceMarkdown: lorem(SIZES.byteFaithful) },
          { raw: true }
        )
      ),
  },
  {
    command: 'lumo doc show <doc> --section <heading>',
    kind: 'byte-faithful',
    uncapped: () =>
      bytesText(
        selectDocShowOutput(
          {
            id: 'd',
            title: 'D',
            sourceMarkdown: makeDocWithSection(SIZES.byteFaithful),
          },
          { section: '## Big' }
        )
      ),
    actual: () =>
      bytesText(
        selectDocShowOutput(
          {
            id: 'd',
            title: 'D',
            sourceMarkdown: makeDocWithSection(SIZES.byteFaithful),
          },
          { section: '## Big' }
        )
      ),
  },
  {
    command: 'lumo doc diff <doc>',
    kind: 'byte-faithful',
    uncapped: () => {
      const common = lorem(SIZES.byteFaithful)
      return formatUnifiedDiff(
        `${common}\nLINE-A`,
        `${common}\nLINE-B`,
        'remote',
        'local'
      )
    },
    actual: () => {
      const common = lorem(SIZES.byteFaithful)
      return formatUnifiedDiff(
        `${common}\nLINE-A`,
        `${common}\nLINE-B`,
        'remote',
        'local'
      )
    },
  },
]

// ── Audit ────────────────────────────────────────────────────────────────────

const POINTER_MARK = 'not shown (output capped at'

export interface CommandAudit {
  command: string
  kind: CommandKind
  /** Byte-faithful reads are exempt: they must stay full (never capped). */
  exempt: boolean
  realisticUncappedTokens: number
  realisticActualTokens: number
  extremeUncappedTokens: number
  extremeActualTokens: number
  /** Realistic full output would exceed the budget AND nothing caps it. */
  flaggedUnbounded: boolean
  /** Output has a hard ceiling (extreme actual stays within budget). */
  hasOutputCeiling: boolean
  /** v1 added a ceiling that holds an otherwise-overflowing command in budget. */
  cappedInV1: boolean
  /** The fetch-more pointer the command emits when capped (null if never). */
  fetchPointer: string | null
}

function pointerLine(text: string): string | null {
  const line = text.split('\n').find(l => l.includes(POINTER_MARK))
  return line ?? null
}

export function auditAgentFacingCommands(): CommandAudit[] {
  return PROBES.map(p => {
    const exempt = p.kind === 'byte-faithful'
    const realisticUncappedTokens = estimateTokens(p.uncapped('realistic'))
    const realisticActual = p.actual('realistic')
    const extremeUncappedTokens = estimateTokens(p.uncapped('extreme'))
    const extremeActual = p.actual('extreme')
    const extremeActualTokens = estimateTokens(extremeActual)
    const hasOutputCeiling = !exempt && extremeActualTokens <= BUDGET
    // Flagged = a non-exempt command whose realistic full output blows the
    // budget. These are the ones the deliverable calls out (and v1 caps).
    const flaggedUnbounded = !exempt && realisticUncappedTokens > BUDGET
    return {
      command: p.command,
      kind: p.kind,
      exempt,
      realisticUncappedTokens,
      realisticActualTokens: estimateTokens(realisticActual),
      extremeUncappedTokens,
      extremeActualTokens,
      flaggedUnbounded,
      hasOutputCeiling,
      cappedInV1: !exempt && hasOutputCeiling && extremeUncappedTokens > BUDGET,
      fetchPointer: pointerLine(extremeActual),
    }
  })
}

// ── Report (run: npx tsx scripts/analysis/cli-output-budget/audit.ts) ─────────

function fmtTokens(n: number): string {
  return n.toLocaleString('en-US')
}

export function renderReport(rows: CommandAudit[]): string {
  const out: string[] = []
  out.push(`# Agent-facing CLI output-token-budget audit (LUM-428)`)
  out.push('')
  out.push(
    `Budget anchor: ${fmtTokens(BUDGET)} tokens (Claude Code default tool-result cap).`
  )
  out.push('')
  out.push(
    '| command | kind | realistic uncapped | agent receives (capped) | extreme uncapped→actual | status |'
  )
  out.push('| --- | --- | ---: | ---: | ---: | --- |')
  for (const r of rows) {
    const status = r.exempt
      ? 'EXEMPT (byte-faithful — never capped)'
      : r.cappedInV1
        ? 'CAPPED in v1 ✅'
        : r.flaggedUnbounded
          ? 'FLAGGED unbounded ⚠'
          : 'within budget (no cap needed)'
    out.push(
      `| \`${r.command}\` | ${r.kind} | ${fmtTokens(r.realisticUncappedTokens)} | ${fmtTokens(r.realisticActualTokens)} | ${fmtTokens(r.extremeUncappedTokens)}→${fmtTokens(r.extremeActualTokens)} | ${status} |`
    )
  }
  out.push('')
  const capped = rows.filter(r => r.cappedInV1).map(r => r.command)
  const exempt = rows.filter(r => r.exempt).map(r => r.command)
  const safe = rows.filter(r => !r.exempt && !r.cappedInV1).map(r => r.command)
  out.push(
    `**Capped in v1** (overflowed at realistic input): ${capped.join(' · ')}`
  )
  out.push(
    `**Exempt** (byte-faithful edit bases, must stay full): ${exempt.join(' · ')}`
  )
  out.push(
    `**Within budget at realistic input** (cap deferred, measure-first): ${safe.join(' · ')}`
  )
  return out.join('\n')
}

if (require.main === module) {
  process.stdout.write(renderReport(auditAgentFacingCommands()) + '\n')
}
