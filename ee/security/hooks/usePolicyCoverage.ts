'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import type { PolicyCoverage } from '@/ee/security/services/policy-coverage.service'
import { securityScanClient } from '@/ee/security/api-client'

/** LUM-1114: per project, the policy rules no detector checks automatically. */
export function usePolicyCoverage() {
  const query = useQuery<PolicyCoverage>({
    queryKey: queryKeys.workspacePolicyCoverage(),
    queryFn: () => securityScanClient.policyCoverage(),
    staleTime: 60 * 1000,
  })
  // `isError` lets the card say "could not check" instead of "all checked".
  return {
    data: query.data,
    isLoading: query.isPending,
    isError: query.isError,
  }
}
