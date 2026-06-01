import { parseGoogleDocId } from '@/lib/integrations/google-drive/parse-url'

describe('parseGoogleDocId', () => {
  it('extracts the fileId from a standard /document/d/<id>/edit url', () => {
    expect(
      parseGoogleDocId(
        'https://docs.google.com/document/d/1AbC_def-123/edit#heading=h.x'
      )
    ).toBe('1AbC_def-123')
  })
  it('extracts from a drive open?id= url', () => {
    expect(
      parseGoogleDocId('https://drive.google.com/open?id=1AbC_def-123')
    ).toBe('1AbC_def-123')
  })
  it('accepts a bare file id', () => {
    expect(parseGoogleDocId('1AbC_def-123')).toBe('1AbC_def-123')
  })
  it('returns null for a non-google url', () => {
    expect(parseGoogleDocId('https://example.com/foo')).toBeNull()
  })
})
