/**
 * @jest-environment node
 */

/**
 * LUM-916: Vercel Blob access is per STORE. The default token
 * (BLOB_READ_WRITE_TOKEN) belongs to a PUBLIC store, which rejects
 * `access: 'private'` at runtime — and every unit test mocks the SDK, so the
 * mistake stays green until production (it did: LUM-858 exports and LUM-735
 * SARIF uploads shipped that way). This guard reads the source instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { privateBlobToken } from '@/lib/blob/private-store'

const ROOT = join(__dirname, '..', '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

describe('private blob calls always use the private store token', () => {
  it('every file that uses a private blob passes privateBlobToken()', () => {
    const offenders: string[] = []
    const users: string[] = []
    for (const dir of ['lib', 'app', 'scripts']) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const src = readFileSync(file, 'utf8')
        if (!/from '@vercel\/blob(\/client)?'/.test(src)) continue
        const privateUse =
          /access:\s*'private'/.test(src) || /\bhandleUpload\(/.test(src)
        if (!privateUse) continue
        users.push(relative(ROOT, file))
        if (!/privateBlobToken\(\)/.test(src))
          offenders.push(relative(ROOT, file))
      }
    }
    // The scan must actually be looking at the private-blob modules.
    expect(users).toEqual(
      expect.arrayContaining([
        'lib/services/private-file-blob.ts',
        'lib/services/workspace-export-blob.ts',
        'lib/services/security-sarif-blob.ts',
        'lib/services/public-blob-migration-blob.ts',
        'app/api/integrations/security/sarif/upload/route.ts',
      ])
    )
    expect(offenders).toEqual([])
  })

  it('fails loudly instead of falling back to the public store', () => {
    const old = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
    try {
      delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
      expect(() => privateBlobToken()).toThrow('BLOB_PRIVATE_READ_WRITE_TOKEN')
      process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = '  tok  '
      expect(privateBlobToken()).toBe('tok')
    } finally {
      process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = old
    }
  })
})
