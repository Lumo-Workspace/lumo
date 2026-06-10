import { parseMentionedTaskIds } from '@/lib/editor/parse-mentions'

const taskMention = (id: string, label = 'LUM-9') =>
  `<a class="mention mention-task" data-mention-type="task" data-id="${id}" data-href="/w/t/${label}">${label}</a>`
const userMention = (id: string) =>
  `<span class="mention mention-user" data-mention-type="user" data-id="${id}">@u</span>`

describe('parseMentionedTaskIds', () => {
  it('extracts task-type mention ids', () => {
    expect(parseMentionedTaskIds(`<p>需要先 ${taskMention('ct1')}</p>`, 'self')).toEqual(['ct1'])
  })
  it('skips user mentions and legacy mentions without type attr', () => {
    const html = `<p>${userMention('clerk1')}<span class="mention" data-id="clerk2">@x</span></p>`
    expect(parseMentionedTaskIds(html, 'self')).toEqual([])
  })
  it('excludes self and dedupes', () => {
    const html = `<p>${taskMention('self')}${taskMention('ct2')}${taskMention('ct2')}</p>`
    expect(parseMentionedTaskIds(html, 'self')).toEqual(['ct2'])
  })
  it('returns [] for empty html and never throws', () => {
    expect(parseMentionedTaskIds('', 'self')).toEqual([])
  })
})
