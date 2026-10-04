/**
 * @jest-environment node
 *
 * LUM-974: task templates are CLI-only. The web UI (new-task template picker,
 * Settings → Task templates page, LUM-972 copy) is gone, no front-end code
 * calls /api/task-templates any more, and only the built-in template's
 * name / description keys (used by the CLI list output) stay in the locales.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const WS = 'app/workspace/[workspaceUrl]'
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}

describe('task template web UI removed (LUM-974)', () => {
  it('the picker, settings page, hook, web client and copy helper are deleted', () => {
    for (const rel of [
      `${WS}/components/fields/TaskTemplateSelect.tsx`,
      `${WS}/components/modals/template-prefill.ts`,
      `${WS}/components/pages/TaskTemplatesSettingsPage.tsx`,
      `${WS}/settings/task-templates/page.tsx`,
      `${WS}/hooks/useTaskTemplates.ts`,
      'lib/api-client/task-templates.ts',
      'lib/task-templates/copy.ts',
    ]) {
      expect({ rel, exists: exists(rel) }).toEqual({ rel, exists: false })
    }
  })

  it('the new-task modal has no template field', () => {
    const src = read(`${WS}/components/modals/NewTaskModal.tsx`)
    expect(src).not.toMatch(/TaskTemplate|useTaskTemplates|taskTemplate\./)
  })

  it('no front-end code calls /api/task-templates', () => {
    const callers = [
      ...sourceFiles('app/workspace'),
      ...sourceFiles('components'),
      ...sourceFiles('lib/api-client'),
    ].filter(rel => read(rel).includes('/api/task-templates'))
    expect(callers).toEqual([])
  })

  it('only the built-in name / description keys remain in every locale', () => {
    const dir = path.join(ROOT, 'lib/i18n')
    const locales = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    expect(locales).toHaveLength(16)
    for (const f of locales) {
      const keys = Object.keys(
        JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      ).filter(k => k.startsWith('taskTemplate.'))
      expect({ f, keys: keys.sort() }).toEqual({
        f,
        keys: [
          'taskTemplate.agentBrief.description',
          'taskTemplate.agentBrief.name',
        ],
      })
    }
  })
})
