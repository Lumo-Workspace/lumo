/**
 * @jest-environment jsdom
 *
 * LUM-819 返工：从 `#run-<id>` 深链进来时那条 run 被标出来。LUM-1231 起抽查
 * 功能已删除，执行历史不再显示复核结论。
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        let raw = messages[id] ?? id
        for (const [k, v] of Object.entries(values ?? {}))
          raw = raw.split(`{${k}}`).join(String(v))
        return raw
      },
    }),
  }
})

import { RunHistoryList } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunHistoryList'

const run = (id: string, review: unknown) =>
  ({
    id,
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'PASS',
    environment: 'PRODUCTION',
    failureAttribution: null,
    unprovenVerification: [],
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    evidence: [{ type: 'link', url: 'https://example.test/log' }],
    note: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    actorMemberId: null,
    sourceSessionId: null,
    createdAt: '2026-09-23T08:00:00.000Z',
    disposition: null,
    review,
  }) as never

describe('RunHistoryList — run deep links (spot-check removed, LUM-1231)', () => {
  it('renders no spot-check verdict line, even for a legacy review payload, and marks the deep-linked run', () => {
    window.location.hash = '#run-r-back'
    render(
      <RunHistoryList
        runs={[
          run('r-back', {
            accepted: false,
            note: 'log is from another branch',
            reviewer: 'Ann',
            reviewedAt: '2026-09-23T09:00:00.000Z',
          }),
          run('r-none', null),
        ]}
        pullRequests={[]}
        requiredEnvironment={null}
      />
    )
    expect(document.body).not.toHaveTextContent(/Spot-check/i)
    expect(document.body).not.toHaveTextContent('log is from another branch')
    // evidence strips are <li>s too — address the run rows by their anchor id
    const row = (id: string) => document.getElementById(`run-${id}`)!
    expect(row('r-back').className).toMatch(/outline/)
    expect(row('r-none').className).not.toMatch(/outline/)
  })

  it('a deep link jumps straight to the linked run', () => {
    // jsdom has no scrollIntoView — install a spy on the prototype
    const spy = jest.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: spy,
    })
    window.location.hash = '#run-r-target'
    render(
      <RunHistoryList
        runs={[run('r-other', null), run('r-target', null)]}
        pullRequests={[]}
        requiredEnvironment={null}
      />
    )
    expect(spy).toHaveBeenCalledTimes(1)
    const [opts] = spy.mock.calls[0]!
    expect(opts).toEqual({ block: 'center' })
    // no smooth animation: it must land even when the page is not compositing
    expect(opts).not.toHaveProperty('behavior')
    expect(spy.mock.contexts[0]).toBe(document.getElementById('run-r-target'))
    expect(document.getElementById('run-r-target')!.className).toMatch(
      /outline/
    )
  })
})
