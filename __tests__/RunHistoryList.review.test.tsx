/**
 * @jest-environment jsdom
 *
 * LUM-819 返工：抽查结论回写到任务的执行历史；从抽查卡片深链进来时那条 run
 * 被标出来。
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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

describe('RunHistoryList — spot-check verdicts', () => {
  it('shows who sent a pass back, when, and why — and marks the deep-linked run', () => {
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
          run('r-ok', {
            accepted: true,
            note: null,
            reviewer: 'Bo',
            reviewedAt: '2026-09-22T09:00:00.000Z',
          }),
          run('r-none', null),
        ]}
        pullRequests={[]}
        requiredEnvironment={null}
      />
    )
    expect(
      screen.getByText(
        'Spot-check sent this pass back — the evidence did not hold it up · Ann · 2026-09-23'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('“log is from another branch”')).toBeInTheDocument()
    expect(
      screen.getByText('Spot-checked: the evidence holds · Bo · 2026-09-22')
    ).toBeInTheDocument()
    // evidence strips are <li>s too — address the run rows by their anchor id
    const row = (id: string) => document.getElementById(`run-${id}`)!
    expect(row('r-back').className).toMatch(/outline/)
    expect(row('r-ok').className).not.toMatch(/outline/)
    expect(row('r-none')).not.toHaveTextContent(/Spot-check/)
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
