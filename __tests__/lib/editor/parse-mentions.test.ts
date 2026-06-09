import { renderMentionHTML } from '@/lib/editor/nodes/mention-with-type'
import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'

/**
 * 把节点 renderHTML 返回的 DOM-spec 序列化成 HTML 字符串。
 * 关键:输入由真实渲染器派生 —— renderHTML 一旦改属性,这里的输入随之改变,
 * 关掉「单测用假 HTML 永远绿」的根因。
 */
function renderMentionToHtml(attrs: Record<string, unknown>): string {
  const htmlAttrs: Record<string, string> = {}
  if (attrs.id != null) htmlAttrs['data-id'] = String(attrs.id)
  htmlAttrs['data-mention-type'] = String(attrs.mentionType ?? 'user')
  if (attrs.mentionStatus != null)
    htmlAttrs['data-mention-status'] = String(attrs.mentionStatus)
  if (attrs.mentionTitle != null)
    htmlAttrs['data-mention-title'] = String(attrs.mentionTitle)
  const [tag, mergedAttrs, text] = renderMentionHTML(attrs, htmlAttrs)
  const attrStr = Object.entries(mergedAttrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  return `<${tag}${attrStr}>${text}</${tag}>`
}

describe('parseMentionedUserClerkIds', () => {
  it('extracts clerkId from a real user mention (no data-type="mention")', () => {
    const html = renderMentionToHtml({
      mentionType: 'user',
      id: 'user_alice',
      label: 'Alice',
    })
    expect(html).not.toContain('data-type="mention"')
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual([
      'user_alice',
    ])
  })

  it('ignores task / sprint / project / milestone mentions', () => {
    const html =
      renderMentionToHtml({
        mentionType: 'task',
        id: 'task_123',
        label: 'LUM-1',
        mentionTitle: 'Fix bug',
        mentionStatus: 'IN_PROGRESS',
      }) +
      renderMentionToHtml({
        mentionType: 'sprint',
        id: 'sp_1',
        label: 'Sprint 1',
      }) +
      renderMentionToHtml({
        mentionType: 'project',
        id: 'pr_1',
        label: 'Lumo',
      }) +
      renderMentionToHtml({ mentionType: 'milestone', id: 'ms_1', label: 'v1' })
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual([])
  })

  it('excludes the author and __agent__, and dedups repeats', () => {
    const html =
      renderMentionToHtml({
        mentionType: 'user',
        id: 'user_self',
        label: 'Me',
      }) +
      renderMentionToHtml({
        mentionType: 'user',
        id: '__agent__',
        label: 'Agent',
      }) +
      renderMentionToHtml({
        mentionType: 'user',
        id: 'user_bob',
        label: 'Bob',
      }) +
      renderMentionToHtml({ mentionType: 'user', id: 'user_bob', label: 'Bob' })
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual(['user_bob'])
  })

  it('treats a legacy mention with no data-mention-type as a user', () => {
    const html = '<span class="mention" data-id="user_legacy">@Legacy</span>'
    expect(parseMentionedUserClerkIds(html, 'user_self')).toEqual([
      'user_legacy',
    ])
  })

  it('returns [] for empty / mention-free html', () => {
    expect(parseMentionedUserClerkIds('<p>hi there</p>', 'x')).toEqual([])
    expect(parseMentionedUserClerkIds('', 'x')).toEqual([])
  })
})
