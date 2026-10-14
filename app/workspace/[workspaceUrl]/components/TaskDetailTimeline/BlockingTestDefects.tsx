'use client'

import { useIntl } from 'react-intl'
import { useTestCases } from '../../hooks/useTestCases'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'
import type { TestCaseOwnerRef } from '@/lib/api-client/test-cases'
import { DisposeControl } from './RunHistoryList'
import { runAnchorId } from './taskTabs'

/**
 * LUM-1011: 「需要处理」里的测试缺陷——每条用例最新一次 run 被证明是实现缺陷、
 * 还没人裁定的那条（LUM-812 的拦截面）。原地裁定；裁完它就离开这里，那条 run
 * 仍留在「测试用例」区段里带着裁定徽章——清掉的是「拦」，不是「有这回事」。
 *
 * 与测试用例区段读同一个 react-query key（一次请求）。
 */
export function BlockingTestDefects({
  taskId,
  taskIdentifier,
  enabled,
}: {
  taskId: string
  taskIdentifier: string
  enabled: boolean
}) {
  return (
    <TestDefectRulings
      owner={{ kind: 'task', id: taskId }}
      handlePrefix={taskIdentifier}
      enabled={enabled}
    />
  )
}

/**
 * LUM-1135: 里程碑上同一份裁定入口——未裁定的已证缺陷拦着关闭闸。文案按
 * owner 区分（DisposeControl 的 ownerKind），请求走同一个 useTestCases。
 */
export function MilestoneTestDefects({
  milestoneId,
  milestoneName,
}: {
  milestoneId: string
  milestoneName: string
}) {
  return (
    <TestDefectRulings
      owner={{ kind: 'milestone', id: milestoneId }}
      handlePrefix={milestoneName}
      enabled
    />
  )
}

function TestDefectRulings({
  owner,
  handlePrefix,
  enabled,
}: {
  owner: TestCaseOwnerRef
  handlePrefix: string
  enabled: boolean
}) {
  const intl = useIntl()
  const { testCases, disposeDefect } = useTestCases(owner, enabled)
  const { blocking } = summarizeTestCases(testCases)
  if (blocking.length === 0) return null

  return (
    <ul
      data-testid='blocking-test-defects'
      className='overflow-hidden rounded-lg border border-danger-border'
    >
      {blocking.map(d => (
        <li
          key={d.runId}
          className='flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-body first:border-t-0'
        >
          <a
            href={`#${runAnchorId(d.runId)}`}
            className='text-body-strong text-foreground hover:underline'
            title={`${handlePrefix}/TC${d.caseNumber}`}
          >
            {intl.formatMessage(
              { id: 'testCases.caseLabel' },
              { n: d.caseNumber }
            )}
          </a>
          <span className='min-w-0 grow text-foreground'>{d.title}</span>
          <span className='text-caption text-danger-text'>
            {intl.formatMessage({
              id: 'testCases.cause.IMPLEMENTATION_DEFECT',
            })}
          </span>
          <span className='basis-full text-caption'>
            <DisposeControl
              runId={d.runId}
              onDispose={(runId, ruling) => void disposeDefect(runId, ruling)}
              ownerKind={owner.kind}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}
