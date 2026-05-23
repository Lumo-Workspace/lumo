/**
 * @jest-environment node
 *
 * LUM-83 Bug 2 — `lumo doc create` 500s for any non-trivial content while
 * a curl call with the same body returns 201. This test pins down the
 * exact wire payload the CLI sends (captured live against an echo server)
 * and asserts the route handler returns 2xx, not 5xx.
 *
 * If something on the server side (e.g. an unhandled throw inside
 * documentService.createDocument) drops the response, this catches it.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(async () => ({
    clerkId: 'user_1',
    memberId: 'mem_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'lumo',
    workspaceName: 'Lumo',
    source: 'bearer',
  })),
}))
jest.mock('@/lib/services', () => ({
  documentService: {
    createDocument: jest.fn(async () => ({ id: 'doc_1', title: 'smoke' })),
  },
}))

import { POST } from '@/app/api/documents/route'
import { documentService } from '@/lib/services'

const create = documentService.createDocument as jest.Mock

function cliPostReq(body: Record<string, unknown>): NextRequest {
  // Reproduces the headers/body the CLI emits (verified against an echo
  // server with `lumo doc create "smoke" --scope workspace --content "..."`).
  return new NextRequest('http://localhost/api/documents', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      authorization: 'Bearer lum_test',
      'content-type': 'application/json',
      accept: '*/*',
      'accept-encoding': 'gzip, deflate',
      'user-agent': 'node',
    },
  })
}

describe('POST /api/documents — CLI wire payload', () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns 201 for the CLI's `--content 'hello world'` body", async () => {
    const res = await POST(
      cliPostReq({
        title: 'smoke',
        visibility: 'WORKSPACE',
        contentMarkdown: 'hello world',
      })
    )
    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledWith(
      'ws_1',
      'mem_1',
      expect.objectContaining({
        title: 'smoke',
        visibility: 'WORKSPACE',
        contentMarkdown: 'hello world',
      })
    )
  })

  it("returns 201 for the CLI's empty-title default", async () => {
    // `lumo doc create --scope workspace --content "x"` (no title positional)
    // sends `title: ''`. The schema must accept it.
    const res = await POST(
      cliPostReq({ title: '', visibility: 'WORKSPACE', contentMarkdown: 'x' })
    )
    expect(res.status).toBe(201)
  })

  it('returns 201 for an 8 KB representative spec markdown', async () => {
    // Synthesised to match the bug-report repro: headings/lists/code/tables.
    const sections = Array.from({ length: 60 }, (_, i) =>
      [
        `## Section ${i}`,
        '',
        `Paragraph ${i} with **bold**, *italic*, \`code\` and [a link](https://example.com).`,
        '',
        '- bullet a',
        '- bullet b',
        '',
        '```ts',
        `const v${i} = ${i}`,
        '```',
        '',
        '| col1 | col2 |',
        '| ---- | ---- |',
        '| 1    | 2    |',
      ].join('\n')
    )
    const md = sections.join('\n\n')
    expect(md.length).toBeGreaterThanOrEqual(8000)

    const res = await POST(
      cliPostReq({
        title: 'spec',
        visibility: 'WORKSPACE',
        contentMarkdown: md,
      })
    )
    expect(res.status).toBe(201)
  })
})
