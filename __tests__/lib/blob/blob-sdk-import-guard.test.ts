/**
 * @jest-environment node
 */
// LUM-1021 regression guard: blob SDKs (@vercel/blob, @aws-sdk/*) may only be
// imported from lib/blob/. Everything else goes through getBlobStorage() from
// @/lib/blob/storage so the app works on Vercel Blob, S3/MinIO and local disk.
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
// LUM-1065: ee/ is the security plugin tree (absent from the OSS snapshot).
const SCANNED_DIRS = ['app', 'lib', 'components', 'shared', 'scripts', 'ee']
const ALLOWED_PREFIX = path.join('lib', 'blob') + path.sep
// Any quoted module specifier counts, wherever it sits: `from`, `import()`,
// `require()`, side-effect imports, multi-line imports. Prose is ignored.
const IMPORT_RE = /['"](?:@vercel\/blob|@aws-sdk\/[^'"\s]+)(?:\/[^'"\s]*)?['"]/

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Pure: repo-relative paths of files that import a blob SDK. */
function findOffendingImports(files: Array<[string, string]>): string[] {
  return files
    .filter(([rel]) => !rel.startsWith(ALLOWED_PREFIX))
    .filter(([, src]) => IMPORT_RE.test(src))
    .map(([rel]) => rel)
}

describe('blob SDK import guard (LUM-1021)', () => {
  it('detects static, dynamic, subpath, multi-line and side-effect imports but ignores prose', () => {
    const fixtures: Array<[string, string]> = [
      ['app/a.ts', "import { put } from '@vercel/blob'"],
      ['lib/b.ts', "const m = await import('@vercel/blob/client')"],
      ['lib/c.ts', 'const m = require("@aws-sdk/client-s3")'],
      [
        'lib/d.ts',
        "export { getSignedUrl } from '@aws-sdk/s3-request-presigner'",
      ],
      ['lib/e.ts', '// we used to call @vercel/blob directly'],
      ['lib/f.ts', "import {\n  put,\n  del,\n} from\n  '@vercel/blob'"],
      ['lib/g.ts', "import '@aws-sdk/client-s3'"],
      ['scripts/h.ts', "import { list } from '@vercel/blob'"],
      [
        path.join('lib', 'blob', 'vercel-blob-storage.ts'),
        "import { put } from '@vercel/blob'",
      ],
      [
        path.join('lib', 'blob', 's3-blob-storage.ts'),
        "import { S3Client } from '@aws-sdk/client-s3'",
      ],
    ]
    expect(findOffendingImports(fixtures)).toEqual([
      'app/a.ts',
      'lib/b.ts',
      'lib/c.ts',
      'lib/d.ts',
      'lib/f.ts',
      'lib/g.ts',
      'scripts/h.ts',
    ])
  })

  it('no file outside lib/blob imports a blob SDK', () => {
    const files = SCANNED_DIRS.flatMap(d => listSourceFiles(path.join(ROOT, d)))
    expect(files.length).toBeGreaterThan(100)
    const pairs = files.map(
      f =>
        [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')] as [string, string]
    )
    expect(findOffendingImports(pairs)).toEqual([])
  })

  it('the backends themselves are the places that do', () => {
    for (const file of [
      'vercel-blob-storage.ts',
      'client-upload.ts',
      's3-blob-storage.ts',
    ]) {
      const src = fs.readFileSync(path.join(ROOT, 'lib', 'blob', file), 'utf8')
      expect(IMPORT_RE.test(src)).toBe(true)
    }
  })
})
