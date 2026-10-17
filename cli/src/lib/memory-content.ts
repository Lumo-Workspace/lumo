// Category/field metadata + builders for the `lumo memory` commands.
// Mirrors the four content shapes validated server-side by parseMemoryContent.
import { emptyState } from './format'
import { sanitizeField } from './sanitize'
import { SHORT_REF_LENGTH, shortRef } from '../../../shared/src/short-ref'

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
 * Fixed-width rows: ref  SCOPE  CATEGORY  headline  source(auto|manual).
 * LUM-1230: the first column is the 8-char short ref `lumo memory show|rm|
 * promote` accept — the full cuid stays in `--json`.
 */
export function formatMemoryList(rows: MemoryRowLike[]): string {
  if (rows.length === 0) return emptyState('memories')
  const idW = SHORT_REF_LENGTH
  const scopeW = Math.max(...rows.map(r => r.scope.length))
  const catW = Math.max(...rows.map(r => r.category.length))
  return rows
    .map(r => {
      const src = r.createdByMemberId ? 'manual' : 'auto'
      return `${shortRef(r.id).padEnd(idW)}  ${r.scope.padEnd(scopeW)}  ${r.category.padEnd(catW)}  ${headline(r.category, r.content)}  ${src}`
    })
    .join('\n')
}
