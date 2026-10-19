// Category/field metadata + builders for the `lumo memory` commands.
// Mirrors the four content shapes validated server-side by parseMemoryContent.
import { emptyState } from './format'
import { renderListTable, type ListRenderOptions } from './list-table'
import {
  bulletLines,
  fieldLines,
  sectionHeading,
  wrapLines,
  type LayoutOptions,
} from './report-layout'
import { heading } from './ui'
import { sanitizeField } from './sanitize'
import { shortRef } from '../../../shared/src/short-ref'

type Built =
  | {
      ok: true
      category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
      content: Record<string, unknown>
    }
  | { ok: false; error: string }

export interface MemoryFlags {
  trigger?: string
  outcome?: string
  workaround?: string
  what?: string
  why?: string
  alternatives?: string
  implications?: string
  rule?: string
  applies?: string
  workflow?: string
  step?: string[]
}

const trimmed = (v?: string) => (v ?? '').trim()

/**
 * Validate the per-category flags and assemble { category, content }. Required
 * fields must be non-empty; optional string fields are dropped when blank;
 * `--applies` maps to convention `content.scope`; repeated `--step` becomes a
 * trimmed, empty-filtered `steps` array (omitted when empty).
 */
export function buildMemoryContent(
  category: string,
  flags: MemoryFlags
): Built {
  const cat = category?.toLowerCase()
  switch (cat) {
    case 'trap': {
      const trigger = trimmed(flags.trigger)
      const outcome = trimmed(flags.outcome)
      const workaround = trimmed(flags.workaround)
      if (!trigger)
        return { ok: false, error: '--trigger is required for category trap.' }
      if (!outcome)
        return { ok: false, error: '--outcome is required for category trap.' }
      return {
        ok: true,
        category: 'TRAP',
        content: { trigger, outcome, ...(workaround ? { workaround } : {}) },
      }
    }
    case 'decision': {
      const what = trimmed(flags.what)
      const why = trimmed(flags.why)
      const alternatives = trimmed(flags.alternatives)
      const implications = trimmed(flags.implications)
      if (!what)
        return { ok: false, error: '--what is required for category decision.' }
      if (!why)
        return { ok: false, error: '--why is required for category decision.' }
      return {
        ok: true,
        category: 'DECISION',
        content: {
          what,
          why,
          ...(alternatives ? { alternatives } : {}),
          ...(implications ? { implications } : {}),
        },
      }
    }
    case 'convention': {
      const rule = trimmed(flags.rule)
      const applies = trimmed(flags.applies)
      if (!rule)
        return {
          ok: false,
          error: '--rule is required for category convention.',
        }
      if (!applies)
        return {
          ok: false,
          error:
            '--applies is required for category convention (where the rule applies).',
        }
      return {
        ok: true,
        category: 'CONVENTION',
        content: { rule, scope: applies },
      }
    }
    case 'procedural': {
      const workflow = trimmed(flags.workflow)
      const trigger = trimmed(flags.trigger)
      const steps = (flags.step ?? []).map(s => s.trim()).filter(Boolean)
      if (!workflow)
        return {
          ok: false,
          error: '--workflow is required for category procedural.',
        }
      if (!trigger)
        return {
          ok: false,
          error: '--trigger is required for category procedural.',
        }
      return {
        ok: true,
        category: 'PROCEDURAL',
        content: { workflow, trigger, ...(steps.length ? { steps } : {}) },
      }
    }
    default:
      return {
        ok: false,
        error: `Unknown --category "${category}". Use trap | decision | convention | procedural.`,
      }
  }
}

export interface MemoryRowLike {
  id: string
  scope: string
  category: string
  content: unknown
  createdByMemberId: string | null
}

function headline(category: string, content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>
  const key =
    category === 'TRAP'
      ? 'trigger'
      : category === 'DECISION'
        ? 'what'
        : category === 'CONVENTION'
          ? 'rule'
          : 'workflow'
  const v = c[key]
  return typeof v === 'string' && v.length > 0
    ? sanitizeField(v)
    : '(unparseable)'
}

/**
 * Rows: ref  SCOPE  CATEGORY  SOURCE(auto|manual)  headline — through the
 * shared list renderer (LUM-1232 batch A: header + headline cut to the
 * terminal on a TTY, TAB-separated piped; the free-text headline is last).
 * LUM-1230: the first column is the 8-char short ref `lumo memory show|rm|
 * promote` accept — the full cuid stays in `--json`.
 */
export function formatMemoryList(
  rows: MemoryRowLike[],
  opts: ListRenderOptions = {}
): string {
  if (rows.length === 0) return emptyState('memories')
  return renderListTable(
    rows.map(r => [
      shortRef(r.id),
      r.scope,
      r.category,
      r.createdByMemberId ? 'manual' : 'auto',
      headline(r.category, r.content),
    ]),
    {
      header: ['ID', 'SCOPE', 'CATEGORY', 'SOURCE', 'HEADLINE'],
      flex: 4,
      ...opts,
    }
  )
}

/** `whyNot` → `Why not`, `summary` → `Summary`. */
function sectionTitle(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/**
 * LUM-1232 batch B (D-5): one memory as a detail view, never raw JSON —
 * `<ref>  <summary or headline>`, its type, then one section per content
 * field (lists as bullets). Untrusted text is sanitized here.
 */
export function formatMemoryShow(
  memory: { id: string; category: string; content: unknown },
  opts: LayoutOptions = {}
): string {
  const c =
    memory.content && typeof memory.content === 'object'
      ? (memory.content as Record<string, unknown>)
      : {}
  const firstText = Object.values(c).find(
    (v): v is string => typeof v === 'string' && v.trim() !== ''
  )
  const fromCategory = headline(memory.category, c)
  const summary =
    typeof c.summary === 'string' && c.summary.trim() !== ''
      ? sanitizeField(c.summary)
      : fromCategory !== '(unparseable)'
        ? fromCategory
        : firstText
          ? sanitizeField(firstText)
          : '-'
  const lines = [
    heading(`${shortRef(memory.id)}  ${summary}`, {
      color: opts.color === true,
    }),
    ...fieldLines(
      [{ label: 'Type', value: sanitizeField(memory.category) }],
      0,
      opts
    ),
  ]
  for (const [key, value] of Object.entries(c)) {
    if (
      key === 'summary' ||
      value === null ||
      value === undefined ||
      value === ''
    )
      continue
    lines.push(...sectionHeading(sectionTitle(key), opts))
    if (Array.isArray(value)) {
      for (const item of value)
        lines.push(...bulletLines(sanitizeField(String(item)), 2, opts))
    } else if (typeof value === 'object') {
      lines.push(...wrapLines(sanitizeField(JSON.stringify(value)), 2, opts))
    } else {
      lines.push(...wrapLines(sanitizeField(String(value)), 2, opts))
    }
  }
  return lines.join('\n')
}
