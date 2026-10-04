'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTestCases } from '../../hooks/useTestCases'
import { TestCaseCard } from './TestCaseCard'
import { TestCaseForm } from './TestCaseForm'
import { RecordRunDialog } from './RecordRunDialog'
import type {
  CreateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'

interface TestCasesTabProps {
  taskId: string
  taskIdentifier: string
  enabled: boolean
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'edit'; caseId: string }
  | { kind: 'run'; caseId: string }

/**
 * LUM-801: Tests tab —— 任务的 test case 列表与写操作的编排点。
 *
 * 子组件都是纯渲染 + 回调；请求全部经 useTestCases（它调 api-client）。
 * 这一层唯一的「业务」判断是 web 端的 commitSha 快照：人选了 PR 之后，把该 PR
 * 当下的 head 冻下来，这样 PR 后续 push 时这条 run 会被正确判为陈旧。
 */
export function TestCasesTab({
  taskId,
  taskIdentifier,
  enabled,
}: TestCasesTabProps) {
  const intl = useIntl()
  const {
    testCases,
    pullRequests,
    loading,
    error,
    add,
    update,
    remove,
    recordRun,
    disposeDefect,
  } = useTestCases(taskId, enabled)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })

  const active =
    mode.kind === 'edit' || mode.kind === 'run'
      ? (testCases.find(c => c.id === mode.caseId) ?? null)
      : null

  /**
   * 人在 web 上选的是 PR 号；这次执行对应的 commit 是那个 PR **当下** 的 head。
   * PR 已合并时取 mergeCommitSha —— 生产上跑的那次对应的是合并 commit，不是 PR 头。
   */
  function snapshotCommit(prNumber: number | null | undefined): string | null {
    if (prNumber == null) return null
    const pr = pullRequests.find(p => p.number === prNumber)
    if (!pr) return null
    return pr.state === 'merged'
      ? (pr.mergeCommitSha ?? pr.headSha)
      : pr.headSha
  }

  async function handleCreate(body: CreateTestCaseBody) {
    await add(body)
    setMode({ kind: 'idle' })
  }

  async function handleEdit(body: CreateTestCaseBody) {
    if (mode.kind !== 'edit') return
    const target = testCases.find(c => c.id === mode.caseId)
    if (!target) return
    await update(String(target.number), body)
    setMode({ kind: 'idle' })
  }

  async function handleRecordRun(body: RecordRunBody, files: File[]) {
    if (mode.kind !== 'run') return
    const target = testCases.find(c => c.id === mode.caseId)
    if (!target) return
    await recordRun(
      String(target.number),
      { ...body, commitSha: snapshotCommit(body.pullRequestNumber) },
      files
    )
  }

  async function handleRemove(number: number) {
    if (
      !window.confirm(intl.formatMessage({ id: 'testCases.removeConfirm' }))
    ) {
      return
    }
    await remove(String(number))
  }

  if (loading) {
    return (
      <p className='px-3 py-6 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.loading' })}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-3 px-3 py-3'>
      {error ? <p className='text-body text-danger-text'>{error}</p> : null}

      {testCases.length === 0 && mode.kind !== 'create' ? (
        <div className='py-6'>
          <p className='text-body-strong text-foreground'>
            {intl.formatMessage({ id: 'testCases.empty.title' })}
          </p>
          <p className='mt-1 text-body text-muted-foreground'>
            {intl.formatMessage({ id: 'testCases.empty.body' })}
          </p>
        </div>
      ) : null}

      {testCases.map(c => (
        <div key={c.id} className='flex flex-col gap-2'>
          {mode.kind === 'edit' && mode.caseId === c.id ? (
            <TestCaseForm
              initial={c}
              onSubmit={handleEdit}
              onCancel={() => setMode({ kind: 'idle' })}
            />
          ) : (
            <TestCaseCard
              testCase={c}
              taskIdentifier={taskIdentifier}
              runs={c.runs}
              pullRequests={pullRequests}
              onRecordRun={() => setMode({ kind: 'run', caseId: c.id })}
              onEdit={() => setMode({ kind: 'edit', caseId: c.id })}
              onRemove={() => void handleRemove(c.number)}
              onDispose={(runId, ruling) => void disposeDefect(runId, ruling)}
            />
          )}
          {mode.kind === 'run' && mode.caseId === c.id && active ? (
            <RecordRunDialog
              testCase={active}
              pullRequests={pullRequests}
              onSubmit={handleRecordRun}
              onClose={() => setMode({ kind: 'idle' })}
            />
          ) : null}
        </div>
      ))}

      {mode.kind === 'create' ? (
        <TestCaseForm
          onSubmit={handleCreate}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      ) : (
        <button
          type='button'
          onClick={() => setMode({ kind: 'create' })}
          className='self-start text-[11px] text-muted-foreground hover:text-foreground'
        >
          + {intl.formatMessage({ id: 'testCases.add' })}
        </button>
      )}
    </div>
  )
}
