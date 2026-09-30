import {
  evidencePathname,
  fileRouteUrl,
  imagePathname,
  parsePrivateFilePath,
  pathnameOf,
  referencedImagePathnames,
  withShareToken,
} from '@/lib/files/private-file-path'

const IMG = 'workspaces/ws-a/images/abc-123'

describe('private file paths (LUM-916)', () => {
  it('round-trips evidence and image pathnames through the parser', () => {
    const e = evidencePathname('t1', 'c1', 'f1')
    const i = imagePathname('ws-a', 'f2')
    expect(parsePrivateFilePath(e)).toEqual({
      kind: 'evidence',
      taskId: 't1',
      caseId: 'c1',
      fileId: 'f1',
    })
    expect(parsePrivateFilePath(i)).toEqual({
      kind: 'image',
      workspaceId: 'ws-a',
      fileId: 'f2',
    })
    expect(pathnameOf(parsePrivateFilePath(e)!)).toBe(e)
    expect(pathnameOf(parsePrivateFilePath(i)!)).toBe(i)
  })

  it('rejects other prefixes, extensions, traversal and wrong depth', () => {
    for (const p of [
      'workspaces/ws-a/exports/x',
      'workspaces/ws-a/logo-1',
      'security-sarif/a/b/c',
      'test-evidence/t1/c1/f1.png',
      'test-evidence/t1/../f1',
      'test-evidence/t1/c1',
      'test-evidence/t1/c1/f1/extra',
      '',
    ]) {
      expect(parsePrivateFilePath(p)).toBeNull()
    }
  })

  it('builds file-route URLs without a doubled slash', () => {
    expect(fileRouteUrl('https://a.test/', IMG)).toBe(
      `https://a.test/api/files/${IMG}`
    )
  })

  it('finds image references in HTML and markdown, absolute or relative', () => {
    const refs = referencedImagePathnames(
      `<img src="https://x.test/api/files/${IMG}?share=t">` +
        ' ![a](/api/files/workspaces/ws-b/images/zzz)' +
        ' <a href="/api/files/test-evidence/t/c/f">'
    )
    expect([...refs].sort()).toEqual([IMG, 'workspaces/ws-b/images/zzz'])
  })

  it('appends the share token to file-route image URLs only', () => {
    expect(withShareToken(`https://x.test/api/files/${IMG}`, 'a b')).toBe(
      `https://x.test/api/files/${IMG}?share=a%20b`
    )
    expect(withShareToken(`/api/files/${IMG}?w=1`, 't')).toBe(
      `/api/files/${IMG}?w=1&share=t`
    )
    for (const other of [
      'https://elsewhere.test/pic.png',
      '/api/files/test-evidence/t/c/f',
      `/api/files/${IMG}/extra`,
    ]) {
      expect(withShareToken(other, 't')).toBe(other)
    }
  })
})
