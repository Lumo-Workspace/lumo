'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  testCasesClient,
  type MilestoneCloseGateView,
  type TestCaseOwnerRef,
  type TestCaseWithRuns,
} from '@/lib/api-client/test-cases'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import type {
  CreateTestCaseBody,
  UpdateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'
import { queryKeys } from '@/lib/query/keys'

interface TestCasesData {
  testCases: TestCaseWithRuns[]
  pullRequests?: TaskPullRequestSnapshot[]
  gate?: MilestoneCloseGateView
}

export interface UseTestCasesResult {
  testCases: TestCaseWithRuns[]
  pullRequests: TaskPullRequestSnapshot[]
  /** LUM-1135: 里程碑的关闭闸门；任务 owner 恒为 null。 */
  gate: MilestoneCloseGateView | null
  loading: boolean
  error: string | null
  add: (payload: CreateTestCaseBody) => Promise<void>
  update: (caseRef: string, payload: UpdateTestCaseBody) => Promise<void>
  remove: (caseRef: string) => Promise<void>
  recordRun: (
    caseRef: string,
    payload: RecordRunBody,
    files: File[]
  ) => Promise<void>
  /** LUM-812: 对一条已证缺陷的 run 落裁定，清它对 DONE 的拦截。 */
  disposeDefect: (
    runId: string,
    ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT',
    note?: string | null
  ) => Promise<void>
}

/**
 * LUM-801: 任务的 test case 列表与写操作。
 *
 * 刻意**不做乐观更新**：一条 run 落库时服务端还要解析 PR 号、快照失败步原文、
 * 写 activity——本地拼一个假行容易和真实结果对不上。写完 invalidate 重取。
 */
export function useTestCases(
  ownerRef: TestCaseOwnerRef,
  enabled = true
): UseTestCasesResult {
  const queryClient = useQueryClient()
  // 依赖 kind/id 原语而非对象身份：调用方常在 render 里内联构造 owner。
  const { kind, id } = ownerRef
  const owner = useMemo<TestCaseOwnerRef>(() => ({ kind, id }), [kind, id])
  const queryKey = useMemo(
    () =>
      kind === 'task'
        ? queryKeys.taskTestCases(id)
        : queryKeys.milestoneTestCases(id),
    [kind, id]
  )

  const query = useQuery<TestCasesData, Error>({
    queryKey,
    queryFn: () => testCasesClient.list(owner),
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
    // 里程碑的 run 可能开/关闭合闸门，页头的完成态要跟着刷新。
    if (kind === 'milestone') {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.milestones.detail(id),
      })
    }
  }, [queryClient, queryKey, kind, id])

  const add = useCallback(
    async (payload: CreateTestCaseBody) => {
      await testCasesClient.add(owner, payload)
      await refresh()
    },
    [owner, refresh]
  )

  const update = useCallback(
    async (caseRef: string, payload: UpdateTestCaseBody) => {
      await testCasesClient.update(owner, caseRef, payload)
      await refresh()
    },
    [owner, refresh]
  )

  const remove = useCallback(
    async (caseRef: string) => {
      await testCasesClient.remove(owner, caseRef)
      await refresh()
    },
    [owner, refresh]
  )

  const recordRun = useCallback(
    async (caseRef: string, payload: RecordRunBody, files: File[]) => {
      // 先传文件再落 run：两步之间失败会留下孤儿 blob，与仓库既有图片上传
      // 同性质，v1 接受，不做补偿事务。
      const uploaded =
        files.length > 0
          ? await testCasesClient.uploadEvidence(owner, caseRef, files)
          : { files: [] }
      await testCasesClient.recordRun(owner, caseRef, {
        ...payload,
        evidence: [
          ...(payload.evidence ?? []),
          ...uploaded.files.map(f => ({ type: 'file' as const, ...f })),
        ],
      })
      await refresh()
    },
    [owner, refresh]
  )

  /**
   * LUM-812: 对一条已证缺陷的 run 落裁定。
   *
   * 裁完必须 refresh —— 拦闸与否是从 run 上的裁定推出来的，不刷新的话卡片还
   * 显示着「未裁定」，而 DONE 闸那边已经放行了。
   */
  const disposeDefect = useCallback(
    async (
      runId: string,
      ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT',
      note?: string | null
    ) => {
      await testCasesClient.disposeDefect(owner, runId, {
        disposition: ruling,
        note: note ?? null,
      })
      await refresh()
    },
    [owner, refresh]
  )

  return {
    testCases: query.data?.testCases ?? [],
    pullRequests: query.data?.pullRequests ?? [],
    gate: query.data?.gate ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    add,
    update,
    remove,
    recordRun,
    disposeDefect,
  }
}
