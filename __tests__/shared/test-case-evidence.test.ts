/** @jest-environment node */
import {
  parseEvidenceEntries,
  isImageEvidence,
  evidenceLabel,
  type EvidenceFile,
} from '../../shared/src/test-case-evidence'
import { evidenceEntrySchema } from '../../lib/validation/test-case'

/**
 * LUM-805 — 读取侧的收窄。
 *
 * `TestCaseRun.evidence` 是 Json 列，读回来是 unknown：历史行、手改的库、
 * 将来的新 type 都可能出现。渲染端做任何形状假设都会在**用户的**页面上炸，
 * 而不是在这里。所以这组测试全是「脏输入进来会怎样」。
 */

const file: EvidenceFile = {
  type: 'file',
  url: 'https://blob.example.com/test-evidence/a/b/c.png',
  filename: 'footer.png',
  contentType: 'image/png',
  size: 1234,
}

describe('parseEvidenceEntries', () => {
  it('keeps a well-formed file entry', () => {
    expect(parseEvidenceEntries([file])).toEqual([file])
  })

  it('keeps a link entry with and without a label', () => {
    expect(
      parseEvidenceEntries([
        { type: 'link', url: 'https://example.com/run/1', label: 'CI run' },
        { type: 'link', url: 'https://example.com/run/2' },
      ])
    ).toEqual([
      { type: 'link', url: 'https://example.com/run/1', label: 'CI run' },
      { type: 'link', url: 'https://example.com/run/2' },
    ])
  })

  it('drops malformed entries instead of throwing', () => {
    const junk = [
      null,
      'a string',
      42,
      {},
      { type: 'file' },
      { type: 'file', url: 'https://x/y.png' }, // no filename/contentType/size
      { ...file, size: 'big' }, // size not a number
      { type: 'wormhole', url: 'https://example.com' }, // unknown type
      { type: 'link' }, // no url
      { type: 'link', url: '   ' },
      file, // the one good entry, last
    ]
    expect(() => parseEvidenceEntries(junk)).not.toThrow()
    expect(parseEvidenceEntries(junk)).toEqual([file])
  })

  it('returns an empty list for a non-array payload', () => {
    for (const value of [null, undefined, {}, 'nope', 7])
      expect(parseEvidenceEntries(value)).toEqual([])
  })

  it('drops urls that are not http(s) — they reach href and src', () => {
    const hostile = [
      { type: 'link', url: 'javascript:alert(1)' },
      { type: 'link', url: 'data:text/html,<script>alert(1)</script>' },
      { ...file, url: 'javascript:alert(1)' },
      { ...file, url: 'not a url at all' },
    ]
    expect(parseEvidenceEntries(hostile)).toEqual([])
  })
})

describe('parity with the write-side zod schema', () => {
  it('accepts every entry the write path accepts', () => {
    const accepted = [
      file,
      { ...file, contentType: 'text/plain', filename: 'run.log' },
      { type: 'link', url: 'https://example.com/x', label: 'CI' },
      { type: 'link', url: 'https://example.com/x' },
    ]
    for (const entry of accepted) {
      expect(evidenceEntrySchema.safeParse(entry).success).toBe(true)
      expect(parseEvidenceEntries([entry])).toHaveLength(1)
    }
  })
})

describe('isImageEvidence', () => {
  it('is true for the four uploadable image types', () => {
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ])
      expect(isImageEvidence({ ...file, contentType })).toBe(true)
  })

  it('is false for logs and json', () => {
    for (const contentType of ['text/plain', 'application/json'])
      expect(isImageEvidence({ ...file, contentType })).toBe(false)
  })

  it('does not guess from the filename extension', () => {
    // 文件名是用户给的，contentType 才是上传时校验过的。
    expect(
      isImageEvidence({
        ...file,
        filename: 'shot.png',
        contentType: 'text/plain',
      })
    ).toBe(false)
  })

  it('is false for a link, however it looks', () => {
    expect(isImageEvidence({ type: 'link', url: 'https://x/y.png' })).toBe(
      false
    )
  })
})

describe('evidenceLabel', () => {
  it('uses the filename for a file', () => {
    expect(evidenceLabel(file)).toBe('footer.png')
  })

  it('uses the label for a link, falling back to the url', () => {
    expect(
      evidenceLabel({ type: 'link', url: 'https://x/y', label: 'CI' })
    ).toBe('CI')
    expect(evidenceLabel({ type: 'link', url: 'https://x/y' })).toBe(
      'https://x/y'
    )
  })
})
