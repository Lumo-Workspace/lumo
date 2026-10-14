'use client'

import { useIntl } from 'react-intl'
import { useTestCases } from '../../hooks/useTestCases'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'
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
  const intl = useIntl()
  const { testCases, disposeDefect } = useTestCases(
    { kind: 'task', id: taskId },
    enabled
  )
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
            title={`${taskIdentifier}/TC${d.caseNumber}`}
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
            />
          </span>
        </li>
      ))}
    </ul>
  )
}
