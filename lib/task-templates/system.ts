import { MESSAGES } from '@/lib/i18n/messages'

/**
 * LUM-970: built-in task templates. They live in code (not a DB seed) so
 * every workspace sees them with no data migration.
 *
 * LUM-973 (v2): the body is content, not UI copy, so it is English in every
 * locale — like the system doc templates in `lib/editor/templates/`. Only the
 * template's name and description are localized. The section headings are
 * the brief's protocol (`lumo task decide` appends under `## Decisions`).
 *
 * LUM-976 (v2.1): hints absorb the LUM-973 / LUM-974 pilot feedback.
 */

/** Recommended brief headings with their drafting hints, in order. Not validated anywhere. */
export const BRIEF_SECTIONS = [
  {
    heading: 'Context',
    hint: 'Current facts this task depends on, each with its source (file path from the repo root, PR or command), plus the commit or date you verified them at. Verify them against the code before writing; facts go stale, so re-verify them when work starts, and where they disagree, the code wins. For deletions or migrations, state a rule ("everything only used by X") instead of listing every item.',
  },
  {
    heading: 'Goal',
    hint: 'What this task delivers, and why, in one or two sentences.',
  },
  {
    heading: 'Non-goals',
    hint: 'What stays out of scope, including nearby work it would be tempting to do along the way.',
  },
  {
    heading: 'Watch out',
    hint: 'Stop conditions: when to pause and ask instead of guessing. Flag cross-cutting concerns too: security / privacy, i18n, data export and migration, conflict-prone files, docs that describe the behavior (keep them in sync).',
  },
  {
    heading: 'Done when',
    hint: 'Each item objectively checkable, naming its evidence (test, command, screenshot). For a bug fix, the check must fail before the fix. Spell out interaction details (when it shows, conflicts) and edge cases: missing or invalid input, permissions, limits, scope.',
  },
  {
    heading: 'Decisions',
    hint: 'Dated rulings, appended as work goes with `lumo task decide <id> "…"`.',
  },
] as const

export const DECISIONS_HEADING = 'Decisions'

export interface SystemTaskTemplate {
  key: string
  name: string
  description: string
  /** Markdown body; the description column stores HTML, converted at use. */
  content: string
}

const SYSTEM_KEYS = ['agent-brief'] as const

/** True when `key` is reserved by a built-in template. */
export function isSystemTemplateKey(key: string): boolean {
  return (SYSTEM_KEYS as readonly string[]).includes(key)
}

/** Map a stored preference / browser locale to a message catalogue key. */
export function resolveTemplateLocale(locale: string | null | undefined) {
  const mapped = locale === 'zh' ? 'zh-CN' : locale === 'es' ? 'es-ES' : locale
  return mapped && mapped in MESSAGES ? mapped : 'en'
}

function message(locale: string, id: string): string {
  return MESSAGES[locale]?.[id] ?? MESSAGES.en?.[id] ?? id
}

/** The agent-brief body: the same English Markdown in every locale. */
const AGENT_BRIEF_CONTENT = `${BRIEF_SECTIONS.map(
  s => `## ${s.heading}\n\n_${s.hint}_`
).join('\n\n')}\n`

/** The built-in templates; name and description follow `locale`. */
export function listSystemTemplates(
  locale: string | null | undefined
): SystemTaskTemplate[] {
  const loc = resolveTemplateLocale(locale)
  return [
    {
      key: 'agent-brief',
      name: message(loc, 'taskTemplate.agentBrief.name'),
      description: message(loc, 'taskTemplate.agentBrief.description'),
      content: AGENT_BRIEF_CONTENT,
    },
  ]
}
