import {
  isTempDocumentId,
  isTempToRealSwap,
  TEMP_DOC_ID_PREFIX,
} from '@/app/workspace/[workspaceUrl]/utils/tempDocId'

const tempId = `${TEMP_DOC_ID_PREFIX}${'abc-123'}`
const realSlug = 'my-doc-42'
const otherTemp = `${TEMP_DOC_ID_PREFIX}${'def-456'}`
const otherSlug = 'other-doc-7'

describe('isTempDocumentId', () => {
  it('is true only for the temp- prefixed optimistic id', () => {
    expect(isTempDocumentId(tempId)).toBe(true)
    expect(isTempDocumentId(realSlug)).toBe(false)
    expect(isTempDocumentId(null)).toBe(false)
    expect(isTempDocumentId(undefined)).toBe(false)
    expect(isTempDocumentId('')).toBe(false)
  })
})

describe('isTempToRealSwap', () => {
  it('is true ONLY on a temp id → real slug transition', () => {
    expect(isTempToRealSwap(tempId, realSlug)).toBe(true)
  })

  it('is false for a real → real navigation (a genuine doc switch still fetches)', () => {
    expect(isTempToRealSwap(realSlug, otherSlug)).toBe(false)
  })

  it('is false for the initial load (no previous id)', () => {
    expect(isTempToRealSwap(null, realSlug)).toBe(false)
    expect(isTempToRealSwap(undefined, realSlug)).toBe(false)
  })

  it('is false for a temp → temp change (still an optimistic placeholder)', () => {
    expect(isTempToRealSwap(tempId, otherTemp)).toBe(false)
  })

  it('is false for a real → temp change', () => {
    expect(isTempToRealSwap(realSlug, tempId)).toBe(false)
  })

  it('is false when the next id is not a genuine slug (null/undefined/empty)', () => {
    expect(isTempToRealSwap(tempId, null)).toBe(false)
    expect(isTempToRealSwap(tempId, undefined)).toBe(false)
    expect(isTempToRealSwap(tempId, '')).toBe(false)
  })

  it('is false when nothing changed (same real id)', () => {
    expect(isTempToRealSwap(realSlug, realSlug)).toBe(false)
  })
})
