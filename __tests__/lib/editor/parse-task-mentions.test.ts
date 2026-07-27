import { renderMentionHTML } from '@/lib/editor/nodes/mention-with-type'
import { parseMentionedTaskIds } from '@/lib/editor/parse-mentions'

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

describe('parseMentionedTaskIds', () => {
  it('extracts task-type mention ids', () => {
    const html = `<p>需要先 ${renderMentionToHtml({ mentionType: 'task', id: 'ct1', label: 'LUM-9' })}</p>`
    expect(parseMentionedTaskIds(html, 'self')).toEqual(['ct1'])
  })

  it('skips user mentions and legacy mentions without type attr', () => {
    const html =
      renderMentionToHtml({
        mentionType: 'user',
        id: 'clerk1',
        label: 'Alice',
      }) + '<span class="mention" data-id="clerk2">@x</span>'
    expect(parseMentionedTaskIds(html, 'self')).toEqual([])
  })

  it('excludes self and dedupes', () => {
    const html =
      renderMentionToHtml({ mentionType: 'task', id: 'self', label: 'LUM-1' }) +
      renderMentionToHtml({ mentionType: 'task', id: 'ct2', label: 'LUM-2' }) +
      renderMentionToHtml({ mentionType: 'task', id: 'ct2', label: 'LUM-2' })
    expect(parseMentionedTaskIds(html, 'self')).toEqual(['ct2'])
  })

  it('returns [] for empty html and never throws', () => {
    expect(parseMentionedTaskIds('', 'self')).toEqual([])
  })

  it('mixed entities: task mention + sprint → only task id returned', () => {
    const html =
      renderMentionToHtml({ mentionType: 'task', id: 'ct3', label: 'LUM-3' }) +
      renderMentionToHtml({
        mentionType: 'sprint',
        id: 'sp_42',
        label: 'Sprint 1',
      })
    expect(parseMentionedTaskIds(html, 'other')).toEqual(['ct3'])
  })

  it('empty selfTaskId: still returns the task id', () => {
    const html = renderMentionToHtml({
      mentionType: 'task',
      id: 'ct4',
      label: 'LUM-4',
    })
    expect(parseMentionedTaskIds(html, '')).toEqual(['ct4'])
  })
})
