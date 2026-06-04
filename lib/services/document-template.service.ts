import { documentTemplateRepository } from '@/lib/repositories/document-template.repository'

export const documentTemplateService = {
  /** List templates visible to a workspace (system + workspace-owned). */
  async listTemplates(workspaceId: string) {
    return documentTemplateRepository.listVisible(workspaceId)
  },

  /**
   * Resolve a template's body for use as a new document's content.
   * Visible iff it's a system template (workspaceId null) or owned by the
   * caller's workspace; otherwise 404 (don't leak other workspaces' ids).
   */
  async getTemplateForCreation(
    workspaceId: string,
    templateId: string
  ): Promise<{ content: string; emoji: string | null }> {
    const template = await documentTemplateRepository.findById(templateId)
    const visible =
      template &&
      (template.workspaceId === null || template.workspaceId === workspaceId)
    if (!template || !visible) {
      throw Object.assign(new Error('Template not found'), { status: 404 })
    }
    return { content: template.content, emoji: template.emoji }
  },
}
