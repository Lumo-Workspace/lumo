'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { useTestCases } from '../../hooks/useTestCases'
import type { TestCaseOwnerRef } from '@/lib/api-client/test-cases'
import { TestCaseCard } from './TestCaseCard'
import { TestCaseForm } from './TestCaseForm'
import { RecordRunDialog } from './RecordRunDialog'
import { runAnchorId } from './taskTabs'
import type {
  CreateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'
import type { WorkspaceMemberInfo } from '../../types'

interface TestCasesSectionProps {
  owner: TestCaseOwnerRef
  /** 句柄前缀：任务标识（LUM-12）或里程碑名。 */
  handlePrefix: string
  enabled: boolean
  /** 运行记录里执行人的头像 / 名片。 */
  members?: WorkspaceMemberInfo[]
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'edit'; caseId: string }
  | { kind: 'run'; caseId: string }

/**
 * LUM-801 → LUM-1011 → LUM-1012: 任务的 test case 列表与写操作的编排点，现在是
 * Record 页 Records 里的「Test cases」一行（原先是独立的 Tests 标签）。
 *
 * 子组件都是纯渲染 + 回调；请求全部经 useTestCases（它调 api-client）。
 * 这一层唯一的「业务」判断是 web 端的 commitSha 快照：人选了 PR 之后，把该 PR
 * 当下的 head 冻下来，这样 PR 后续 push 时这条 run 会被正确判为陈旧。
 */
export function TestCasesSection({
  owner,
  handlePrefix,
  enabled,
  members = [],
}: TestCasesSectionProps) {
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
  } = useTestCases(owner, enabled)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [linkedRunId, setLinkedRunId] = useState<string | null>(null)

  // 深链（`…/record#run-<id>`，旧的 `…/tests#run-<id>` 也重定向到这里）：
  // 展开那条 run 所属的用例，再把它滚进视野。hash 挂载后才读得到、列表又是
  // 异步来的，所以在 effect 里读，不在 render 里读（render 纯度）。
  // 「需要处理」里的缺陷行也是这种锚点，点了只改 hash，所以还要听 hashchange。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => {
      const hash = window.location.hash
      for (const c of testCases) {
        const run = c.runs.find(r => hash === `#${runAnchorId(r.id)}`)
        if (!run) continue
        setLinkedRunId(run.id)
        setExpanded(prev => (prev.has(c.id) ? prev : new Set(prev).add(c.id)))
        return
      }
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [testCases])

  useEffect(() => {
    if (!linkedRunId) return
    // 瞬时跳转，不用 smooth（LUM-819：后台页不合成帧时平滑滚动原地不动）。
    document
      .getElementById(runAnchorId(linkedRunId))
      ?.scrollIntoView?.({ block: 'center' })
  }, [linkedRunId, expanded])

  const toggle = (caseId: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(caseId)) next.delete(caseId)
      else next.add(caseId)
      return next
    })

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
      <p className='py-2 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.loading' })}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      {error ? <p className='text-body text-danger-text'>{error}</p> : null}

      {testCases.length === 0 && mode.kind !== 'create' ? (
        <div className='rounded-lg border border-dashed border-border px-4 py-4'>
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
              taskIdentifier={handlePrefix}
              runs={c.runs}
              pullRequests={pullRequests}
              expanded={expanded.has(c.id)}
              onToggle={() => toggle(c.id)}
              linkedRunId={linkedRunId}
              members={members}
              onRecordRun={() => setMode({ kind: 'run', caseId: c.id })}
              onEdit={() => setMode({ kind: 'edit', caseId: c.id })}
              onRemove={() => void handleRemove(c.number)}
            />
          )}
          {mode.kind === 'run' && mode.caseId === c.id && active ? (
            <RecordRunDialog
              testCase={active}
              pullRequests={pullRequests}
              showPullRequests={owner.kind === 'task'}
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
