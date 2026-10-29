/**
 * @jest-environment node
 *
 * LUM-970 / LUM-973: built-in task templates are code. The agent-brief body
 * (v2) is the same English Markdown in every locale; only its name and
 * description are localized.
 */
import {
  BRIEF_SECTIONS,
  isSystemTemplateKey,
  listSystemTemplates,
  resolveTemplateLocale,
} from '@/lib/task-templates/system'
import { splitDecisionsSection } from '@/lib/task-templates/decisions'
import { MESSAGES } from '@/lib/i18n/messages'
import { normalizeRichText } from '@/lib/utils/markdown'

/** The hint paragraph under `## heading` in a brief body. */
function hintOf(content: string, heading: string): string {
  const parts = content.split(/^## /m)
  const section = parts.find(p => p.startsWith(`${heading}\n`)) ?? ''
  return section.slice(heading.length).trim()
}

describe('system task templates', () => {
  it('agent-brief lists the five brief headings in order (LUM-1303: no Decisions)', () => {
    const [brief] = listSystemTemplates('en')
    expect(brief?.key).toBe('agent-brief')
    const headings = (brief?.content ?? '')
      .split('\n')
      .filter(l => l.startsWith('## '))
    expect(headings).toEqual([
      '## Context',
      '## Goal',
      '## Non-goals',
      '## Watch out',
      '## Done when',
    ])
  })

  it('agent-brief v2 body is the same English in every locale while name and description follow the locale', () => {
    const [en] = listSystemTemplates('en')
    const [zh] = listSystemTemplates('zh-CN')
    expect(zh?.content).toBe(en?.content)
    for (const loc of Object.keys(MESSAGES)) {
      expect(listSystemTemplates(loc)[0]?.content).toBe(en?.content)
    }
    expect(zh?.name).toBe(MESSAGES['zh-CN']?.['taskTemplate.agentBrief.name'])
    expect(zh?.description).toBe(
      MESSAGES['zh-CN']?.['taskTemplate.agentBrief.description']
    )
    expect(zh?.name).not.toBe(en?.name)
    expect(zh?.description).not.toBe(en?.description)
    // English only: no CJK in the body.
    expect(en?.content).not.toMatch(/[　-鿿]/)
  })

  it('agent-brief v2 every section carries a short English hint', () => {
    const content = listSystemTemplates('en')[0]?.content ?? ''
    for (const s of BRIEF_SECTIONS) {
      expect(hintOf(content, s.heading)).toMatch(/^_.+_$/)
    }
    // Soft budget: the whole body stays around 25 lines.
    expect(content.trimEnd().split('\n').length).toBeLessThanOrEqual(25)
  })

  it('agent-brief v2 hints cover the pilot lessons per section', () => {
    const content = listSystemTemplates('en')[0]?.content ?? ''
    const context = hintOf(content, 'Context')
    expect(context).toMatch(/current facts/i)
    expect(context).toMatch(/source/i)
    expect(context).toMatch(/file path/i)
    expect(context).toMatch(/verify/i)

    const done = hintOf(content, 'Done when')
    expect(done).toMatch(/objectively checkable/i)
    expect(done).toMatch(/evidence/i)
    expect(done).toMatch(/bug fix/i)
    expect(done).toMatch(/fail before the fix/i)
    expect(done).toMatch(/when it shows/i)
    expect(done).toMatch(/limits/i)
    expect(done).toMatch(/conflicts/i)

    const watch = hintOf(content, 'Watch out')
    expect(watch).toMatch(/stop conditions/i)
    expect(watch).toMatch(/security/i)
    expect(watch).toMatch(/privacy/i)
    expect(watch).toMatch(/i18n/i)
    expect(watch).toMatch(/export/i)
    expect(watch).toMatch(/migration/i)
    expect(watch).toMatch(/conflict-prone files/i)
  })

  // LUM-976 (v2.1): feedback from the LUM-973 / LUM-974 pilots.
  it('agent-brief v2-1 Context hint asks for the verified commit, re-verification, rules and root paths', () => {
    const context = hintOf(
      listSystemTemplates('en')[0]?.content ?? '',
      'Context'
    )
    expect(context).toMatch(/commit or date/i)
    expect(context).toMatch(/go stale/i)
    expect(context).toMatch(/re-verify them when work starts/i)
    expect(context).toMatch(/deletions or migrations/i)
    expect(context).toMatch(/state a rule/i)
    expect(context).toMatch(/everything only used by X/)
    expect(context).toMatch(/from the repo root/i)
  })

  it('agent-brief v2-1 Watch out hint asks to keep the docs describing the behavior in sync', () => {
    const watch = hintOf(
      listSystemTemplates('en')[0]?.content ?? '',
      'Watch out'
    )
    expect(watch).toMatch(/docs that describe the behavior/i)
    expect(watch).toMatch(/in sync/i)
  })

  it('agent-brief v2-1 Done when hint names the edge cases', () => {
    const done = hintOf(
      listSystemTemplates('en')[0]?.content ?? '',
      'Done when'
    )
    expect(done).toMatch(/edge cases/i)
    expect(done).toMatch(/missing or invalid input/i)
    expect(done).toMatch(/permissions/i)
    expect(done).toMatch(/limits/i)
    expect(done).toMatch(/scope/i)
  })

  it('agent-brief v2 per-section hint keys are gone from every locale', () => {
    const removed = ['goal', 'nonGoals', 'watchOut', 'doneWhen', 'decisions']
    expect(Object.keys(MESSAGES)).toHaveLength(16)
    for (const msgs of Object.values(MESSAGES)) {
      for (const k of removed) {
        expect(msgs[`taskTemplate.agentBrief.${k}`]).toBeUndefined()
      }
      expect(msgs['taskTemplate.agentBrief.name']).toBeTruthy()
      expect(msgs['taskTemplate.agentBrief.description']).toBeTruthy()
    }
  })

  it('agent-brief description names Context first, translated in every locale', () => {
    const CONTEXT_WORD: Record<string, string> = {
      en: 'Context',
      'en-AU': 'Context',
      'en-GB': 'Context',
      de: 'Kontext',
      'es-ES': 'Contexto',
      'es-419': 'Contexto',
      fr: 'Contexte',
      hi: 'संदर्भ',
      id: 'Konteks',
      ja: '背景',
      ko: '배경',
      ms: 'Konteks',
      ru: 'Контекст',
      vi: 'Bối cảnh',
      'zh-CN': '背景',
      'zh-TW': '背景',
    }
    expect(Object.keys(MESSAGES).sort()).toEqual(
      Object.keys(CONTEXT_WORD).sort()
    )
    const en = MESSAGES.en?.['taskTemplate.agentBrief.description']
    expect(en).toBe('Context, goal, non-goals, stop conditions, done criteria')
    for (const [loc, word] of Object.entries(CONTEXT_WORD)) {
      const desc = MESSAGES[loc]?.['taskTemplate.agentBrief.description'] ?? ''
      expect({ loc, starts: desc.startsWith(word) }).toEqual({
        loc,
        starts: true,
      })
      if (!loc.startsWith('en'))
        expect({ loc, desc }).not.toEqual({ loc, desc: en })
    }
  })

  it('a brief made from the LUM-970 template gives up its Decisions section and keeps the rest', () => {
    const md = `${listSystemTemplates('zh-CN')[0]?.content ?? ''}\n## Decisions\n\n_Dated rulings, appended as work goes with \`lumo task decide <id> "…"\`._\n\n- 2026-10-04 ship \`v2\`\n`
    const html = normalizeRichText(md) ?? ''
    const at = html.indexOf('<h2>Decisions</h2>')
    expect(at).toBeGreaterThan(html.indexOf('<h2>Context</h2>'))
    const split = splitDecisionsSection(html)
    // Everything before the Decisions section is byte-for-byte unchanged.
    expect(split?.description).toBe(html.slice(0, at).trim())
    // The template hint is dropped; the dated line becomes one decision.
    expect(split?.decisions).toEqual([
      { text: 'ship `v2`', date: new Date(Date.UTC(2026, 9, 4, 12)) },
    ])
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
