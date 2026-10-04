/**
 * @jest-environment node
 *
 * LUM-970: built-in task templates are code, localized from the locale files,
 * with fixed English section headings.
 */
import {
  BRIEF_SECTIONS,
  isSystemTemplateKey,
  listSystemTemplates,
  resolveTemplateLocale,
} from '@/lib/task-templates/system'
import { MESSAGES } from '@/lib/i18n/messages'

describe('system task templates', () => {
  it('agent-brief lists the five brief headings in order', () => {
    const [brief] = listSystemTemplates('en')
    expect(brief?.key).toBe('agent-brief')
    const headings = (brief?.content ?? '')
      .split('\n')
      .filter(l => l.startsWith('## '))
    expect(headings).toEqual([
      '## Goal',
      '## Non-goals',
      '## Watch out',
      '## Done when',
      '## Decisions',
    ])
  })

  it('guidance follows the locale while headings stay English', () => {
    const [zh] = listSystemTemplates('zh-CN')
    expect(zh?.name).toBe(MESSAGES['zh-CN']?.['taskTemplate.agentBrief.name'])
    expect(zh?.content).toContain('## Non-goals')
    expect(zh?.content).toContain(
      MESSAGES['zh-CN']?.['taskTemplate.agentBrief.nonGoals'] as string
    )
  })

  it('every locale has its own (non-English) guidance for each section', () => {
    const en = MESSAGES.en as Record<string, string>
    for (const [loc, msgs] of Object.entries(MESSAGES)) {
      for (const s of BRIEF_SECTIONS) {
        expect(msgs[s.hintKey]).toBeTruthy()
        if (!loc.startsWith('en'))
          expect(msgs[s.hintKey]).not.toBe(en[s.hintKey])
      }
    }
  })

  it('unknown / legacy locales resolve to a real catalogue', () => {
    expect(resolveTemplateLocale('zh')).toBe('zh-CN')
    expect(resolveTemplateLocale('es')).toBe('es-ES')
    expect(resolveTemplateLocale('xx')).toBe('en')
    expect(resolveTemplateLocale(null)).toBe('en')
  })

  it('agent-brief is a reserved key; custom keys are not', () => {
    expect(isSystemTemplateKey('agent-brief')).toBe(true)
    expect(isSystemTemplateKey('bug-report')).toBe(false)
  })

  it('no taskTemplate.* message carries ICU tag syntax (a bare <key> breaks formatMessage)', () => {
    for (const msgs of Object.values(MESSAGES)) {
      for (const [id, text] of Object.entries(msgs)) {
        if (id.startsWith('taskTemplate.')) expect(text).not.toMatch(/[<>]/)
      }
    }
  })
})
