/**
 * LUM-916: shared fixtures for the rich-text HTML tests — real editor output
 * (every node/mark, serialised by the real extensions) and a semantic HTML
 * normaliser. Lives outside __tests__ so jest does not collect it.
 */
import { Editor } from '@tiptap/core'
import { getBaseExtensions } from '@/lib/editor/extensions'

/**
 * Semantic form of an HTML string: parsed by the DOM, attributes sorted,
 * inline style re-serialised by the CSS parser, boolean attributes and the
 * forced `disabled` on checkboxes folded — so only a CONTENT difference
 * (a dropped tag, attribute, class or style) fails a comparison.
 */
export function normalize(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.hasAttribute('style'))
      el.setAttribute('style', (el as HTMLElement).style.cssText)
    if (el.tagName === 'INPUT') el.removeAttribute('disabled')
    const attrs = Array.from(el.attributes)
      .map(a => [a.name, a.name === 'checked' ? '' : a.value] as const)
      .sort(([a], [b]) => a.localeCompare(b))
    for (const [name] of attrs) el.removeAttribute(name)
    for (const [name, value] of attrs) el.setAttribute(name, value)
  }
  return root.innerHTML
}

/** Every node/mark the editor supports, parsed and re-serialised BY the editor. */
const AUTHORED = `
<h1>Title</h1><h2 style="text-align: center">Centered</h2>
<p>plain <strong>bold</strong> <em>it</em> <u>under</u> <s>strike</s> <code>code</code>
 <a href="https://example.com/x" target="_blank">link</a>
 <span style="color: #ff0000">red</span> <mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">hl</mark>
 <span data-type="mention" data-id="u1" data-label="Alice" data-mention-type="user">@Alice</span>
 <a data-type="mention" data-id="t1" data-label="LUM-1" data-mention-type="task" data-href="/workspace/acme/my-tasks/LUM-1" href="/workspace/acme/my-tasks/LUM-1">LUM-1</a>
 <span data-comment-id="c1">commented</span></p>
<ul><li><p>bullet</p></li></ul><ol start="3"><li><p>numbered</p></li></ol>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li></ul>
<blockquote><p>quote</p></blockquote>
<pre><code class="language-ts">const x = 1</code></pre>
<hr>
<img src="https://www.uselumo.ai/api/files/workspaces/ws1/images/abc" alt="shot">
<table><tbody><tr><th colspan="1" rowspan="1"><p>h</p></th></tr><tr><td colspan="1" rowspan="1"><p>c</p></td></tr></tbody></table>
<div data-callout data-variant="info"><p>callout</p></div>
<pre data-type="mermaid"><code>graph TD; A--&gt;B</code></pre>
<div data-toggle><div data-toggle-summary>sum</div><div data-toggle-content><p>body</p></div></div>
`

/** Every node/mark the editor supports, as the real editor serialises it. */
export function editorHtml(): string {
  const editor = new Editor({
    extensions: getBaseExtensions(),
    content: AUTHORED,
  })
  // Mentions are inserted as nodes (as the '@' picker does), not parsed.
  editor.commands.insertContentAt(1, [
    {
      type: 'mention',
      attrs: { id: 'u1', label: 'Alice', mentionType: 'user' },
    },
    {
      type: 'mention',
      attrs: {
        id: 't1',
        label: 'LUM-1',
        mentionType: 'task',
        mentionHref: '/workspace/acme/my-tasks/LUM-1',
      },
    },
  ])
  const html = editor.getHTML()
  editor.destroy()
  return html
}
