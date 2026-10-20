// Mocks must be declared before imports (Jest hoists jest.mock automatically)
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findEditable: jest.fn(),
    createMentions: jest.fn(async () => ({ count: 0 })),
    updateContent: jest.fn(async () => ({
      updatedAt: new Date('2026-05-24T10:00:00Z'),
    })),
  },
}))

jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(
    async (
      _pid: string,
      input: { title: string },
      _aid: string,
      _cid: string
    ) => ({
      task: {
        id: `cm_${input.title}`,
        teamIdentifier: 'LUM',
        number: 100,
        title: input.title,
      },
      taskTags: [],
    })
  ),
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor_1' })),
  },
}))

// runInTransaction delegates to prisma.$transaction; the document writes go
// through the mocked documentRepository, so the tx client is unused here.
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({})
    ),
  },
}))

import { findExtractionCandidates } from '@/lib/services/document-task-extraction.service'
import { replaceWithTaskLink } from '@/lib/services/document-task-extraction.service'
import { extractTasksFromDoc } from '@/lib/services/document-task-extraction.service'
import { documentRepository } from '@/lib/repositories/document.repository'
import { parse } from 'node-html-parser'

describe('findExtractionCandidates', () => {
  const taskListHtml = `
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
      <li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>
      <li data-type="taskItem" data-checked="false"><div><p>second</p></div></li>
    </ul>
  `

  it('all_unchecked selector picks only unchecked items', () => {
    const cs = findExtractionCandidates(taskListHtml, { type: 'all_unchecked' })
    expect(cs.map(c => c.text)).toEqual(['first', 'second'])
  })

  it('all_unchecked skips items already linked', () => {
    const html = `
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false">
          <div><p><a data-task-link="cm_x">already</a></p></div>
        </li>
        <li data-type="taskItem" data-checked="false"><div><p>fresh</p></div></li>
      </ul>
    `
    const cs = findExtractionCandidates(html, { type: 'all_unchecked' })
    expect(cs.map(c => c.text)).toEqual(['fresh'])
  })

  it('marked selector picks data-extract-pending nodes', () => {
    const html = `
      <p>before <span data-extract-pending="true">hello</span> after</p>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false" data-extract-pending="true">
          <div><p>checkbox item</p></div>
        </li>
      </ul>
    `
    const cs = findExtractionCandidates(html, { type: 'marked' })
    expect(cs.map(c => c.text)).toEqual(['hello', 'checkbox item'])
  })

  it('returns empty array when nothing matches', () => {
    const cs = findExtractionCandidates('<p>plain</p>', { type: 'marked' })
    expect(cs).toEqual([])
  })
})

describe('replaceWithTaskLink', () => {
  it('wraps taskItem inner text with anchor and stamps li attrs', () => {
    const root = parse(`
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
      </ul>
    `)
    const li = root.querySelector('li')!
    replaceWithTaskLink(li, {
      taskId: 'cm_a',
      identifier: 'LUM-1',
      href: '/workspace/lumo/my-tasks/LUM-1',
    })
    const html = root.toString()
    expect(html).toContain('data-task-id="cm_a"')
    expect(html).toContain('data-task-identifier="LUM-1"')
    expect(html).toMatch(/<a [^>]*data-task-link="cm_a"[^>]*>first<\/a>/)
    // The <li> remains in place
    expect(root.querySelectorAll('li').length).toBe(1)
  })

  it('replaces data-extract-pending span with anchor in place', () => {
    const root = parse(
      '<p>pre <span data-extract-pending="true">mid</span> post</p>'
    )
    const span = root.querySelector('span')!
    replaceWithTaskLink(span, {
      taskId: 'cm_b',
      identifier: 'LUM-2',
      href: '/workspace/lumo/my-tasks/LUM-2',
    })
    expect(root.toString()).toBe(
      '<p>pre <a data-task-link="cm_b" data-task-identifier="LUM-2" href="/workspace/lumo/my-tasks/LUM-2">mid</a> post</p>'
    )
  })
})

describe('extractTasksFromDoc', () => {
  beforeEach(() => jest.clearAllMocks())

  const baseDoc = {
    id: 'doc_1',
    projectId: 'proj_1',
    workspaceId: 'ws_1',
    workspace: { slug: 'lumo' },
    content: '',
  }

  it('extracts all unchecked items and returns tasks + updatedContent', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
        <li data-type="taskItem" data-checked="false"><div><p>second</p></div></li>
      </ul>`,
    })

    const res = await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
        <li data-type="taskItem" data-checked="false"><div><p>second</p></div></li>
      </ul>`,
      selector: { type: 'all_unchecked' },
    })

    expect(res.tasks.map(t => t.title)).toEqual(['first', 'second'])
    expect(res.tasks.map(t => t.identifier)).toEqual(['LUM-100', 'LUM-100'])
    expect(res.updatedContent).toContain('data-task-id="cm_first"')
    expect(res.skipped).toEqual([])
  })

  it('creates each task as the calling member (LUM-1283 creator)', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
    })
    const { createTask } = jest.requireMock(
      '@/lib/services/task-creation.service'
    ) as { createTask: jest.Mock }

    await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>only</p></div></li>
      </ul>`,
      selector: { type: 'all_unchecked' },
    })

    // createTask records its actorId argument as createdByActorId.
    expect(createTask).toHaveBeenCalledWith(
      'proj_1',
      expect.objectContaining({ title: 'only' }),
      'actor_1',
      'user_1'
    )
  })

  it('skips empty checkbox items', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
    })

    const res = await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p></p></div></li>
        <li data-type="taskItem" data-checked="false"><div><p>real</p></div></li>
      </ul>`,
      selector: { type: 'all_unchecked' },
    })

    expect(res.tasks.map(t => t.title)).toEqual(['real'])
    expect(res.skipped).toEqual([{ reason: 'empty' }])
  })

  it('truncates over-200-char titles and stores rest in description', async () => {
    const long = 'a'.repeat(250)
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
    })

    const { createTask } = require('@/lib/services/task-creation.service')

    await extractTasksFromDoc({
      documentId: 'doc_1',
      memberId: 'mem_1',
      callerClerkId: 'user_1',
      workspaceId: 'ws_1',
      content: `<ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><div><p>${long}</p></div></li>
      </ul>`,
      selector: { type: 'all_unchecked' },
    })

    expect(createTask).toHaveBeenCalledWith(
      'proj_1',
      expect.objectContaining({
        title: 'a'.repeat(200),
        description: 'a'.repeat(50),
      }),
      'actor_1',
      'user_1'
    )
  })

  it('throws 400 MISSING_PROJECT when doc has no projectId', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
      projectId: null,
    })

    await expect(
      extractTasksFromDoc({
        documentId: 'doc_1',
        memberId: 'mem_1',
        callerClerkId: 'user_1',
        workspaceId: 'ws_1',
        content: '<p>any</p>',
        selector: { type: 'all_unchecked' },
      })
    ).rejects.toMatchObject({ status: 400, code: 'MISSING_PROJECT' })
  })

  it('throws 403 when findEditable returns null', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce(null)

    await expect(
      extractTasksFromDoc({
        documentId: 'doc_1',
        memberId: 'mem_1',
        callerClerkId: 'user_1',
        workspaceId: 'ws_1',
        content: '<p>any</p>',
        selector: { type: 'all_unchecked' },
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws 409 NO_CANDIDATES when selector finds nothing', async () => {
    ;(documentRepository.findEditable as jest.Mock).mockResolvedValueOnce({
      ...baseDoc,
    })

    await expect(
      extractTasksFromDoc({
        documentId: 'doc_1',
        memberId: 'mem_1',
        callerClerkId: 'user_1',
        workspaceId: 'ws_1',
        content: '<p>just prose</p>',
        selector: { type: 'marked' },
      })
    ).rejects.toMatchObject({ status: 409, code: 'NO_CANDIDATES' })
  })
})
