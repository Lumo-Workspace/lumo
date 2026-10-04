import { apiFetch } from './base'

const BASE = '/api/task-templates'

/** One task template as served by GET /api/task-templates (LUM-970). */
export interface TaskTemplateItem {
  /** null for built-in templates. */
  id: string | null
  key: string
  name: string
  description: string | null
  /** Markdown source. */
  content: string
  /** HTML, ready to drop into the description editor. */
  contentHtml: string
  isSystem: boolean
}

export interface TaskTemplateInput {
  key: string
  name: string
  content: string
}

export const taskTemplatesClient = {
  list(locale?: string) {
    const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
    return apiFetch<{ templates: TaskTemplateItem[] }>(`${BASE}${qs}`)
  },

  create(data: TaskTemplateInput) {
    return apiFetch<{ template: TaskTemplateItem }>(BASE, {
      method: 'POST',
      body: data,
    })
  },

  update(id: string, data: Partial<TaskTemplateInput>) {
    return apiFetch<{ template: TaskTemplateItem }>(`${BASE}/${id}`, {
      method: 'PATCH',
      body: data,
    })
  },

  delete(id: string) {
    return apiFetch<void>(`${BASE}/${id}`, { method: 'DELETE' })
  },
}
