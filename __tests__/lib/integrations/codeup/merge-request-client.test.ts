/**
 * @jest-environment node
 *
 * LUM-1316 — the Codeup client's merge request calls and the narrowing of
 * their answers (documented response samples), plus the comparison → diff
 * mapping and the webhook action mapping.
 */
import {
  CodeupApiError,
  createCodeupClient,
  encodeRepository,
  toChangeRequest,
  toComments,
  toCompare,
  toFileText,
  toPatchSets,
} from '@/lib/integrations/codeup/client'
import {
  changedFileStatus,
  fileSection,
  hunksOf,
  toChangedFiles,
  toUnifiedDiff,
} from '@/lib/integrations/codeup/diff'
import { pullRequestAction } from '@/lib/services/codeup-webhook.service'
import {
  HEAD,
  LOCAL_ID,
  MR_PATH,
  ORG,
  REPO,
  changeRequest,
  comment,
  compare,
  fakeCodeup,
  patchSets,
} from '@/test-utils/codeup/merge-request-api'

const TOKEN = ['fixture', 'pat'].join('-')
const ref = { repository: REPO, localId: LOCAL_ID }

describe('client calls', () => {
  it('addresses the repository by its URL-encoded full path', () => {
    expect(encodeRepository(REPO)).toBe(`${ORG}%2Fgroup%2Fdemo`)
  })

  it('getChangeRequest / listPatchSets / compare hit the documented paths', async () => {
    const f = fakeCodeup()
    const client = createCodeupClient(ORG, TOKEN, f.fetch)
    await expect(client.getChangeRequest(ref)).resolves.toMatchObject({
      title: 'Add login [LUM-12]',
      sourceCommitId: HEAD,
      ahead: 2,
    })
    await expect(client.listPatchSets(ref)).resolves.toHaveLength(3)
    await expect(client.compare(REPO, 'a', 'b')).resolves.toMatchObject({
      commits: [expect.any(String), HEAD],
    })
    expect(f.calls()).toEqual([
      `GET ${MR_PATH}`,
      `GET ${MR_PATH}/diffs/patches`,
      `GET /repositories/${encodeRepository(REPO)}/compares`,
    ])
    expect(f.fetch.mock.calls[2]![0]).toContain('compares?from=a&to=b')
  })

  it('getFileContent reads the default branch without ref; a 404 is null, other errors throw', async () => {
    const f = fakeCodeup({
      fail: { [`GET /repositories/${encodeRepository(REPO)}/files/x`]: 500 },
    })
    const client = createCodeupClient(ORG, TOKEN, f.fetch)
    await expect(client.getFileContent(REPO, '/.lumo.yaml')).resolves.toBe(
      'paths:\n  - "!dist/**"\n'
    )
    expect(f.fetch.mock.calls[0]![0]).toMatch(/\/files\/\.lumo\.yaml$/)
    await expect(client.getFileContent(REPO, 'x')).rejects.toBeInstanceOf(
      CodeupApiError
    )
    const missing = fakeCodeup({
      fail: { [`GET /repositories/${encodeRepository(REPO)}/files/y`]: 404 },
    })
    await expect(
      createCodeupClient(ORG, TOKEN, missing.fetch).getFileContent(REPO, 'y')
    ).resolves.toBeNull()
  })

  it('createComment refuses an answer without a comment id', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 200 }))
    await expect(
      createCodeupClient(ORG, TOKEN, fetchImpl).createComment(ref, 'p', {
        type: 'GLOBAL_COMMENT',
        content: 'x',
      })
    ).rejects.toEqual(expect.objectContaining({ status: 502 }))
  })

  it('listComments walks the pages, and stops when paging is ignored', async () => {
    const rows = (from: number, n: number) =>
      Array.from({ length: n }, (_, k) =>
        comment({ comment_biz_id: `c${from + k}` })
      )
    const answer = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 })
    const paged = jest.fn(async (url: string, init?: RequestInit) => {
      const resolved = JSON.parse(String(init!.body)).resolved
      if (resolved) return answer([])
      return answer(url.includes('page=1&') ? rows(0, 100) : rows(100, 1))
    })
    await expect(
      createCodeupClient(ORG, TOKEN, paged).listComments(ref, 'INLINE_COMMENT')
    ).resolves.toHaveLength(101)
    expect(paged.mock.calls[1]![0]).toContain(
      '/comments/list?page=2&perPage=100'
    )

    const ignored = jest.fn(async () => answer(rows(0, 100)))
    await expect(
      createCodeupClient(ORG, TOKEN, ignored).listComments(
        ref,
        'GLOBAL_COMMENT'
      )
    ).resolves.toHaveLength(100)
    // page 1 + page 2 (nothing new) for each of resolved false / true.
    expect(ignored).toHaveBeenCalledTimes(3)
  })

  it('an invalid merge request id is refused before any request', async () => {
    const f = fakeCodeup()
    await expect(
      createCodeupClient(ORG, TOKEN, f.fetch).getChangeRequest({
        repository: REPO,
        localId: 0,
      })
    ).rejects.toEqual(expect.objectContaining({ status: 400 }))
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('narrowing', () => {
  it('toChangeRequest keeps what Lumo reads; no branches = not a merge request', () => {
    expect(toChangeRequest(changeRequest)).toEqual({
      title: 'Add login [LUM-12]',
      description: changeRequest.description,
      status: 'UNDER_REVIEW',
      sourceBranch: 'lumo/LUM-12-add-login',
      targetBranch: 'master',
      sourceCommitId: HEAD,
      ahead: 2,
      authorUsername: 'dev',
      webUrl: changeRequest.webUrl,
    })
    expect(() => toChangeRequest({ title: 'x' })).toThrow(CodeupApiError)
  })

  it('toPatchSets drops malformed rows', () => {
    expect(toPatchSets([...patchSets, { commitId: 'x' }, null])).toHaveLength(3)
    expect(toPatchSets({})).toEqual([])
  })

  it('toCompare keeps commit ids and file diffs', () => {
    const c = toCompare(compare)
    expect(c.commits).toHaveLength(2)
    expect(c.diffs.map(d => d.newPath)).toEqual([
      'lib/run.ts',
      'docs/login.md',
      'public/logo.png',
    ])
    expect(toCompare(null)).toEqual({ commits: [], diffs: [] })
  })

  it('toComments drops deleted comments and reads both path spellings', () => {
    const out = toComments([
      comment({
        comment_type: 'INLINE_COMMENT',
        filePath: '/a.ts',
        line_number: 3,
      }),
      comment({ comment_biz_id: 'gone', is_deleted: true }),
      { content: 'no id' },
    ])
    expect(out).toEqual([
      expect.objectContaining({ filePath: '/a.ts', lineNumber: 3 }),
    ])
  })

  it('toFileText decodes base64 and passes text through', () => {
    expect(toFileText({ content: 'aGk=', encoding: 'base64' })).toBe('hi')
    expect(toFileText({ content: 'hi', encoding: 'text' })).toBe('hi')
    expect(toFileText({})).toBeNull()
  })
})

describe('comparison → diff', () => {
  const diffs = toCompare(compare).diffs

  it('hunksOf keeps everything from the first @@', () => {
    expect(hunksOf('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe(
      '@@ -1 +1 @@\n-a\n+b'
    )
    expect(hunksOf('')).toBe('')
  })

  it('changedFileStatus / fileSection: git headers per status, binary marked', () => {
    expect(diffs.map(changedFileStatus)).toEqual([
      'modified',
      'added',
      'modified',
    ])
    expect(changedFileStatus({ ...diffs[0]!, renamedFile: true })).toBe(
      'renamed'
    )
    expect(fileSection({ ...diffs[0]!, deletedFile: true })).toContain(
      '+++ /dev/null'
    )
    expect(fileSection(diffs[2]!)).toBe(
      'diff --git a/public/logo.png b/public/logo.png\nBinary files differ'
    )
  })

  it('toUnifiedDiff joins the sections; nothing changed is empty', () => {
    const diff = toUnifiedDiff(diffs)
    expect(
      diff.startsWith(
        'diff --git a/lib/run.ts b/lib/run.ts\n--- a/lib/run.ts\n+++ b/lib/run.ts\n@@'
      )
    ).toBe(true)
    expect(diff.endsWith('\n')).toBe(true)
    expect(toUnifiedDiff([])).toBe('')
  })

  it('counts a content line that itself starts with ++ or --', () => {
    const d = {
      ...diffs[0]!,
      diff: '--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n---old\n+++new\n+b',
    }
    expect(toChangedFiles([d])[0]).toMatchObject({ additions: 2, deletions: 1 })
  })

  it('toChangedFiles counts lines and keeps a rename’s old name', () => {
    const renamed = { ...diffs[0]!, renamedFile: true, oldPath: 'lib/old.ts' }
    expect(toChangedFiles([renamed])).toEqual([
      {
        filename: 'lib/run.ts',
        status: 'renamed',
        additions: 2,
        deletions: 1,
        previous_filename: 'lib/old.ts',
        patch: hunksOf(renamed.diff),
      },
    ])
  })
})

describe('pullRequestAction (webhook)', () => {
  it('maps Codeup actions; only a moved head is a push', () => {
    expect(pullRequestAction('open', null, HEAD)).toBe('opened')
    expect(pullRequestAction('reopen', null, HEAD)).toBe('reopened')
    expect(pullRequestAction('merge', HEAD, HEAD)).toBe('closed')
    expect(pullRequestAction('close', HEAD, HEAD)).toBe('closed')
    expect(pullRequestAction('update', 'a'.repeat(40), HEAD)).toBe(
      'synchronize'
    )
    expect(pullRequestAction('update', null, HEAD)).toBe('synchronize')
    expect(pullRequestAction('update', HEAD, HEAD)).toBe('edited')
    expect(pullRequestAction('update', HEAD, null)).toBe('edited')
    expect(pullRequestAction(null, null, null)).toBe('unknown')
    expect(pullRequestAction('approved', null, null)).toBe('approved')
  })
})
