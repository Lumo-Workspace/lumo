/**
 * @jest-environment node
 *
 * LUM-83 — server-side regression:
 *
 *   The doc editor (DescriptionEditor.tsx) drives content via
 *   `editor.commands.setContent(value)` and `editor.getHTML()`, i.e. it
 *   round-trips HTML strings. The CLI's `contentMarkdown` therefore has to
 *   be converted to HTML before storage — converting it to a tiptap JSON
 *   string instead causes Tiptap to parse the JSON-as-HTML on first load,
 *   escape every char, and write back `<p>{escaped-json}</p>` on the next
 *   user edit. These tests pin down "must be HTML, not JSON".
 */
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn(async () => ({
    getUserList: jest.fn(async () => ({
      data: [
        {
          id: 'user_1',
          firstName: 'CLI',
          lastName: null,
          imageUrl: null,
          emailAddresses: [{ emailAddress: 'cli@uselumo.ai' }],
        },
      ],
    })),
  })),
}))
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    getMaxSortOrder: jest.fn(),
    create: jest.fn(),
    updateWithChildrenAndMentions: jest.fn(),
    findWithPermission: jest.fn(),
    upsertEditor: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { findByDocument: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
    findByIdForMention: jest.fn(),
  },
}))

import { documentService } from '@/lib/services/document.service'
import { documentRepository } from '@/lib/repositories/document.repository'

const getMaxSortOrder = documentRepository.getMaxSortOrder as jest.Mock
const create = documentRepository.create as jest.Mock
const updateWithChildrenAndMentions =
  documentRepository.updateWithChildrenAndMentions as jest.Mock
const findWithPermission = documentRepository.findWithPermission as jest.Mock
const upsertEditor = documentRepository.upsertEditor as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  getMaxSortOrder.mockResolvedValue(0)
  create.mockImplementation(async (data: { content?: string | null }) => ({
    id: 'doc_1',
    title: 'T',
    content: data.content ?? null,
    createdBy: { id: 'mem_1', clerkId: 'user_1' },
    project: null,
  }))
  updateWithChildrenAndMentions.mockResolvedValue({ id: 'doc_1' })
})

function captureCreateContent(): string | undefined {
  expect(create).toHaveBeenCalledTimes(1)
  const arg = create.mock.calls[0]![0] as { content?: string }
  return arg.content
}

describe('documentService.createDocument — content storage shape', () => {
  it('stores non-trivial markdown as HTML the Tiptap editor can read back', async () => {
    const md =
      '# Heading\n\nParagraph with **bold** and *italic*.\n\n- one\n- two\n'
    await documentService.createDocument('ws_1', 'mem_1', {
      title: 'T',
      visibility: 'WORKSPACE',
      contentMarkdown: md,
    })

    const content = captureCreateContent()
    expect(content).toBeDefined()
    // Must be HTML matching the editor's setContent/getHTML contract.
    expect(content).toMatch(/<h1>Heading<\/h1>/)
    expect(content).toMatch(/<strong>bold<\/strong>/)
    expect(content).toMatch(/<em>italic<\/em>/)
    expect(content).toMatch(/<ul>/)
    // And must NOT be a JSON-stringified tiptap doc, which Tiptap interprets
    // as HTML and wraps in <p> on the next render.
    expect(content!.startsWith('{')).toBe(false)
    expect(content).not.toMatch(/^"?\{"type":"doc"/)
  })

  it('stores empty content when contentMarkdown is omitted', async () => {
    await documentService.createDocument('ws_1', 'mem_1', {
      title: 'T',
      visibility: 'WORKSPACE',
    })
    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0]![0] as { content?: string }
    expect(arg.content).toBeUndefined()
  })
})

describe('documentService.getDocument — derived contentMarkdown', () => {
  function mockDoc(content: string | null) {
    findWithPermission.mockResolvedValueOnce({
      id: 'doc_1',
      title: 'T',
      content,
      parentId: null,
      createdBy: { id: 'mem_1', clerkId: 'user_1' },
      shares: [],
      mentions: [],
    })
  }

  it('derives markdown from HTML content (new docs)', async () => {
    mockDoc('<h2>Title</h2><p>Body with <strong>bold</strong>.</p>')
    const { document } = (await documentService.getDocument(
      'doc_1',
      'mem_1',
      'ws_1'
    )) as unknown as { document: { contentMarkdown: string } }
    expect(document.contentMarkdown).toMatch(/## Title/)
    expect(document.contentMarkdown).toMatch(/\*\*bold\*\*/)
  })

  it('rehydrates legacy Tiptap-JSON content into HTML + markdown', async () => {
    // The shape the buggy pre-LUM-83 CLI used to write to the DB. The
    // editor would mis-parse this raw JSON-string as HTML on load; the
    // GET path now hands the editor HTML and the CLI markdown.
    const legacy = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Legacy' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body.' }],
        },
      ],
    })
    mockDoc(legacy)
    const { document } = (await documentService.getDocument(
      'doc_1',
      'mem_1',
      'ws_1'
    )) as unknown as {
      document: { content: string; contentMarkdown: string }
    }
    expect(document.contentMarkdown).toMatch(/# Legacy/)
    expect(document.contentMarkdown).toMatch(/Body\./)
    expect(document.content).toMatch(/<h1>Legacy<\/h1>/)
    expect(document.content.startsWith('{')).toBe(false)
  })

  it('returns null contentMarkdown for empty content', async () => {
    mockDoc(null)
    const { document } = (await documentService.getDocument(
      'doc_1',
      'mem_1',
      'ws_1'
    )) as unknown as { document: { contentMarkdown: string | null } }
    expect(document.contentMarkdown).toBeNull()
  })
})

describe('documentService.updateDocument — content storage shape', () => {
  beforeEach(() => {
    findWithPermission.mockResolvedValue({
      id: 'doc_1',
      createdById: 'mem_1',
      shares: [],
    })
    upsertEditor.mockResolvedValue(undefined)
  })

  it('translates contentMarkdown to HTML, not JSON-string', async () => {
    await documentService.updateDocument('doc_1', 'mem_1', 'ws_1', {
      contentMarkdown: '## Sub\n\nBody.\n',
    })

    expect(updateWithChildrenAndMentions).toHaveBeenCalled()
    const call = updateWithChildrenAndMentions.mock.calls[0]!
    const data = call[2] as { content?: string }
    expect(data.content).toBeDefined()
    expect(data.content).toMatch(/<h2>Sub<\/h2>/)
    expect(data.content!.startsWith('{')).toBe(false)
  })
})
