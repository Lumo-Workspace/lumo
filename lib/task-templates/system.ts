import { MESSAGES } from '@/lib/i18n/messages'

/**
 * LUM-970: built-in task templates. They live in code (not a DB seed) so
 * every workspace sees them with no data migration, and their guidance text
 * is localized from the regular locale files.
 *
 * The section headings are fixed English — they are the brief's protocol
 * (`lumo task decide` appends under `## Decisions`), so they read the same in
 * every locale. Only the one-line guidance under each heading is translated.
 */

/** Recommended brief headings, in order. Not validated anywhere. */
export const BRIEF_SECTIONS = [
  { heading: 'Goal', hintKey: 'taskTemplate.agentBrief.goal' },
  { heading: 'Non-goals', hintKey: 'taskTemplate.agentBrief.nonGoals' },
  { heading: 'Watch out', hintKey: 'taskTemplate.agentBrief.watchOut' },
  { heading: 'Done when', hintKey: 'taskTemplate.agentBrief.doneWhen' },
  { heading: 'Decisions', hintKey: 'taskTemplate.agentBrief.decisions' },
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

/** The built-in templates, rendered for `locale`. */
export function listSystemTemplates(
  locale: string | null | undefined
): SystemTaskTemplate[] {
  const loc = resolveTemplateLocale(locale)
  const content = BRIEF_SECTIONS.map(
    s => `## ${s.heading}\n\n_${message(loc, s.hintKey)}_`
  ).join('\n\n')
  return [
    {
      key: 'agent-brief',
      name: message(loc, 'taskTemplate.agentBrief.name'),
      description: message(loc, 'taskTemplate.agentBrief.description'),
      content: `${content}\n`,
    },
  ]
}
