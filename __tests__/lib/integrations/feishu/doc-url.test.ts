/**
 * @jest-environment node
 *
 * LUM-1343 — Feishu / Lark document URLs: docx and wiki are importable,
 * other object types are refused by name, anything else is malformed.
 */
import {
  parseFeishuDocUrl,
  wikiObjKind,
} from '@/lib/integrations/feishu/doc-url'

const TOKEN = 'doxcnAbCdEfGh1234567890XYZ'

describe('parseFeishuDocUrl', () => {
  it.each([
    [`https://acme.feishu.cn/docx/${TOKEN}`, 'docx', 'acme.feishu.cn'],
    [
      `https://acme.larksuite.com/docx/${TOKEN}?from=x#h`,
      'docx',
      'acme.larksuite.com',
    ],
    [
      `https://acme.larkoffice.com/wiki/${TOKEN}`,
      'wiki',
      'acme.larkoffice.com',
    ],
    [`  https://ACME.Feishu.cn/wiki/${TOKEN}/  `, 'wiki', 'acme.feishu.cn'],
  ])('%s → %s', (input, kind, host) => {
    expect(parseFeishuDocUrl(input)).toEqual({
      kind,
      token: TOKEN,
      url: `https://${host}/${kind}/${TOKEN}`,
    })
  })

  it.each([
    ['sheets', 'sheet'],
    ['base', 'bitable'],
    ['slides', 'slides'],
    ['mindnotes', 'mindnote'],
    ['board', 'whiteboard'],
    ['docs', 'doc'],
    ['file', 'file'],
  ])('/%s/ is refused as %s', (segment, type) => {
    expect(
      parseFeishuDocUrl(`https://acme.feishu.cn/${segment}/${TOKEN}`)
    ).toEqual({
      kind: 'unsupported',
      type,
      url: `https://acme.feishu.cn/${segment}/${TOKEN}`,
    })
  })

  it.each([
    '',
    'not a url',
    TOKEN,
    `http://acme.feishu.cn/docx/${TOKEN}`,
    `https://evil.com/docx/${TOKEN}`,
    `https://feishu.cn.evil.com/docx/${TOKEN}`,
    `https://acme.feishu.cn/docx/`,
    `https://acme.feishu.cn/docx/bad-token!`,
    `https://acme.feishu.cn/drive/folder/${TOKEN}`,
    `https://user:pw@acme.feishu.cn/docx/${TOKEN}`,
    `javascript:alert(1)`,
  ])('rejects %p', input => {
    expect(parseFeishuDocUrl(input)).toBeNull()
  })
})

describe('wikiObjKind', () => {
  it('only docx is importable; unknown types are refused', () => {
    expect(wikiObjKind('docx')).toBe('docx')
    expect(wikiObjKind('sheet')).toBe('sheet')
    expect(wikiObjKind('bitable')).toBe('bitable')
    expect(wikiObjKind('doc')).toBe('doc')
    expect(wikiObjKind('whiteboard')).toBe('file')
    expect(wikiObjKind('')).toBe('file')
  })
})
