/** @jest-environment jsdom */

import { extractTaskMentionIdentifiers } from '@/lib/editor/extract-task-mention-identifiers'

describe('extractTaskMentionIdentifiers', () => {
  it('returns [] for empty/blank input', () => {
    expect(extractTaskMentionIdentifiers('')).toEqual([])
    expect(extractTaskMentionIdentifiers('<p>no mentions</p>')).toEqual([])
  })

  it('extracts the LUM-N identifier from task mention anchors (uppercased, deduped)', () => {
    const html =
      '<p>' +
      '<a class="mention mention-task" data-label="LUM-5" data-mention-type="task">LUM-5 Fix bug</a> ' +
      '<a class="mention mention-task" data-label="lum-5" data-mention-type="task">LUM-5 Fix bug</a> ' +
      '<a class="mention mention-task" data-label="SPEC-12" data-mention-type="task">SPEC-12 Thing</a>' +
      '</p>'
    expect(extractTaskMentionIdentifiers(html)).toEqual(['LUM-5', 'SPEC-12'])
  })

  it('falls back to the leading text token when data-label is missing', () => {
    const html =
      '<a class="mention mention-task" data-mention-type="task">LUM-9 Title here</a>'
    expect(extractTaskMentionIdentifiers(html)).toEqual(['LUM-9'])
  })

  it('ignores non-task mentions (users, projects) and plain links', () => {
    const html =
      '<span class="mention mention-user" data-id="u1">@Alice</span>' +
      '<a class="mention mention-project" data-label="Web">Web</a>' +
      '<a href="https://x.com">link</a>'
    expect(extractTaskMentionIdentifiers(html)).toEqual([])
  })
})
