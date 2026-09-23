'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runReviewsClient, type ReviewPoolView } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { addReviewToRate } from '@/lib/test-cases/review'

/**
 * LUM-819 (D): 抽查池页的数据与写入。
 *
 * 复核成功后就地把那条 run 从样本里拿掉、把读数并进这一票——不重新拉取：
 * 重新拉取会重新随机抽样，整页在复核人眼前换一批。
 */
export function useRunReviewPool() {
  const queryClient = useQueryClient()
  const query = useQuery<ReviewPoolView>({
    queryKey: queryKeys.runReviews.pool(),
    queryFn: () => runReviewsClient.pool(),
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationFn: (args: {
      runId: string
      accepted: boolean
      note: string | null
    }) =>
      runReviewsClient.review(args.runId, {
        accepted: args.accepted,
        note: args.note,
      }),
    onSuccess: (_data, args) => {
      queryClient.setQueryData<ReviewPoolView>(
        queryKeys.runReviews.pool(),
        prev =>
          prev && {
            sample: prev.sample.filter(i => i.runId !== args.runId),
            poolSize: Math.max(0, prev.poolSize - 1),
            rate: addReviewToRate(prev.rate, args.accepted),
          }
      )
    },
  })

  return {
    pool: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    reload: query.refetch,
    review: mutation.mutateAsync,
    reviewing: mutation.isPending ? (mutation.variables?.runId ?? null) : null,
    reviewError: mutation.error ? (mutation.error as Error).message : null,
  }
}
