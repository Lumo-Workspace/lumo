import { parse, HTMLElement } from 'node-html-parser'

export type Selector = { type: 'marked' } | { type: 'all_unchecked' }

export interface Candidate {
  node: HTMLElement
  text: string
}

/** Parse HTML and return extraction candidates per selector. Internal helper, exported for unit tests. */
export function findExtractionCandidates(
  html: string,
  selector: Selector
): Candidate[] {
  const root = parse(html)
  let nodes: HTMLElement[]

  if (selector.type === 'all_unchecked') {
    nodes = root
      .querySelectorAll('li[data-type="taskItem"][data-checked="false"]')
      .filter(n => n.querySelector('a[data-task-link]') === null)
  } else {
    nodes = root.querySelectorAll('[data-extract-pending="true"]')
  }

  return nodes.map(node => ({
    node,
    text: node.text.trim(),
  }))
}

export interface ReplacementMeta {
  taskId: string
  identifier: string
  href: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function anchorHtml(text: string, meta: ReplacementMeta): string {
  return (
    `<a data-task-link="${escapeHtml(meta.taskId)}"` +
    ` data-task-identifier="${escapeHtml(meta.identifier)}"` +
    ` href="${escapeHtml(meta.href)}">${escapeHtml(text)}</a>`
  )
}

/** Replace one candidate node in place. Mutates the DOM tree. */
export function replaceWithTaskLink(
  node: HTMLElement,
  meta: ReplacementMeta
): void {
  if (node.tagName === 'LI' && node.getAttribute('data-type') === 'taskItem') {
    node.setAttribute('data-task-id', meta.taskId)
    node.setAttribute('data-task-identifier', meta.identifier)
    const inner = node.querySelector('p') ?? node.querySelector('div')
    if (inner) {
      const text = inner.text.trim()
      inner.set_content(anchorHtml(text, meta))
    }
    return
  }
  // <span data-extract-pending> path
  const text = node.text.trim()
  node.replaceWith(anchorHtml(text, meta))
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

import { runInTransaction } from '@/lib/db/transaction'
import { documentRepository } from '@/lib/repositories/document.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { createTask as createTaskService } from '@/lib/services/task-creation.service'

const DEFAULT_PUBLIC_URL = 'https://www.uselumo.ai'
const MAX_TITLE_LENGTH = 200

function publicUrl(): string {
  const v = process.env.LUMO_PUBLIC_URL?.trim()
  return v && v.length > 0 ? v.replace(/\/+$/, '') : DEFAULT_PUBLIC_URL
}

function httpError(status: number, message: string, code?: string): Error {
  return Object.assign(new Error(message), { status, code })
}

export type SkipReason = 'empty' | 'too_long' | 'invalid_marker'

export interface ExtractArgs {
  documentId: string
  memberId: string
  callerClerkId: string
  workspaceId: string
  content: string
  selector: Selector
}

export interface ExtractResult {
  tasks: Array<{ id: string; identifier: string; title: string }>
  updatedContent: string
  updatedAt: string
  skipped: Array<{ reason: SkipReason; label?: string }>
}

export async function extractTasksFromDoc(
  args: ExtractArgs
): Promise<ExtractResult> {
  const doc = await documentRepository.findEditable(
    args.documentId,
    args.memberId,
    args.workspaceId
  )
  if (!doc) {
    throw httpError(403, 'No edit access to this document')
  }
  if (!doc.projectId) {
    throw httpError(
      400,
      'Document has no project — set a project before extracting tasks',
      'MISSING_PROJECT'
    )
  }

  // Use the caller-provided content. doc may have unsaved local edits.
  // Server still owns post-extract state.
  const root = parse(args.content)
  const candidates = findExtractionCandidatesInRoot(root, args.selector)
  if (candidates.length === 0) {
    throw httpError(409, 'No extraction candidates found', 'NO_CANDIDATES')
  }

  const actor = await memberRepository.findActorByMemberId(args.memberId)
  if (!actor) {
    throw httpError(500, 'Caller has no actor row')
  }

  const skipped: ExtractResult['skipped'] = []
  const created: Array<{
    id: string
    identifier: string
    title: string
    node: HTMLElement
  }> = []

  for (const c of candidates) {
    if (c.text.length === 0) {
      skipped.push({ reason: 'empty' })
      continue
    }
    if (c.node.querySelector('a[data-task-link]') !== null) {
      skipped.push({ reason: 'invalid_marker', label: c.text.slice(0, 80) })
      continue
    }

    const title = c.text.slice(0, MAX_TITLE_LENGTH)
    const description =
      c.text.length > MAX_TITLE_LENGTH ? c.text.slice(MAX_TITLE_LENGTH) : null

    const { task } = await createTaskService(
      doc.projectId,
      {
        title,
        description,
        status: 'TODO',
        priority: 'LOW',
        assigneeActorId: actor.id,
      },
      actor.id,
      args.callerClerkId,
      args.memberId
    )

    const identifier = `${task.teamIdentifier}-${task.number}`
    const workspaceSlug = doc.workspace.slug
    const href = `${publicUrl()}/workspace/${workspaceSlug}/my-tasks/${identifier}`
    replaceWithTaskLink(c.node, { taskId: task.id, identifier, href })

    created.push({ id: task.id, identifier, title, node: c.node })

    if (c.text.length > MAX_TITLE_LENGTH) {
      skipped.push({
        reason: 'too_long',
        label: title.slice(0, 80),
      })
    }
  }

  const updatedHtml = root.toString()

  // Group the mention insert and content update in one transaction so that if
  // the content update fails, the mention insert rolls back too. Both repo
  // methods accept the outer `tx` (transaction-composable, unlike the plain
  // `documentRepository.update`).
  const updated = await runInTransaction(async tx => {
    await documentRepository.createMentions(
      created.map(t => ({
        documentId: doc.id,
        taskId: t.id,
        source: 'EXPLICIT' as const,
      })),
      tx
    )
    return documentRepository.updateContent(
      doc.id,
      doc.workspaceId,
      updatedHtml,
      tx
    )
  })

  return {
    tasks: created.map(({ id, identifier, title }) => ({
      id,
      identifier,
      title,
    })),
    updatedContent: updatedHtml,
    updatedAt: updated.updatedAt.toISOString(),
    skipped,
  }
}

function findExtractionCandidatesInRoot(
  root: HTMLElement,
  selector: Selector
): Candidate[] {
  let nodes: HTMLElement[]
  if (selector.type === 'all_unchecked') {
    nodes = root
      .querySelectorAll('li[data-type="taskItem"][data-checked="false"]')
      .filter(n => n.querySelector('a[data-task-link]') === null)
  } else {
    nodes = root.querySelectorAll('[data-extract-pending="true"]')
  }
  return nodes.map(node => ({ node, text: node.text.trim() }))
}
