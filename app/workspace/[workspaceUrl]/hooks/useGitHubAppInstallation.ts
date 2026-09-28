'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { API } from '../constants'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface GitHubAppStatus {
  installed: boolean
  accountLogin?: string | null
  accountType?: string | null
  repositories?: string[]
  /**
   * In the installation but not yet confirmed for this workspace (LUM-881);
   * `null` when GitHub could not be asked.
   */
  pendingRepositories?: string[] | null
  /** LUM-882 — false when no verifier login is on record (pre-LUM-882 bind). */
  accessRecheckEnabled?: boolean
  /** LUM-882 — repositories the automatic recheck removed since the last re-verify. */
  accessRemovedCount?: number
  accessRemovedAt?: string | null
  /**
   * LUM-888 — why: `access_lost` (the verifier can no longer read them) or
   * `account_gone` (the verifying GitHub account no longer exists).
   */
  accessRemovedReason?: string | null
}

interface UseGitHubAppInstallationReturn {
  status: GitHubAppStatus | null
  loading: boolean
  uninstallOpen: boolean
  setUninstallOpen: (open: boolean) => void
  uninstalling: boolean
  handleInstall: () => void
  handleReverify: () => void
  handleUninstall: () => Promise<void>
}

/**
 * The GitHub **App installation** chain — deliberately separate from
 * `useGitHubIntegration`, which owns the OAuth connection. They are two
 * independent grants: OAuth is a person's token (repo list, PR links, repo
 * webhooks), the installation is a machine identity scoped to `contents:read`
 * that the managed security scan clones with. A workspace can have either, both
 * or neither, so each carries its own status read and its own actions.
 */
export function useGitHubAppInstallation(
  workspaceUrl: string
): UseGitHubAppInstallationReturn {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const statusKey = queryKeys.integrations.githubApp(workspaceUrl)

  const [uninstallOpen, setUninstallOpen] = useState(false)

  const statusQuery = useQuery<GitHubAppStatus>({
    queryKey: statusKey,
    queryFn: () =>
      apiFetch<GitHubAppStatus>(API.github.appInstallation(workspaceUrl)),
  })

  const uninstallMutation = useMutation<void, Error>({
    mutationFn: () =>
      apiFetch<void>(API.github.appInstallation(workspaceUrl), {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.setQueryData<GitHubAppStatus>(statusKey, { installed: false })
      toast.success(intl.formatMessage({ id: 'github.uninstallSuccess' }))
    },
    onError: () => {
      toast.error(intl.formatMessage({ id: 'github.uninstallFailed' }))
    },
    onSettled: () => setUninstallOpen(false),
  })

  // Full-page navigation, not a new tab: GitHub sends the browser back to
  // /api/github/app/setup, which needs this session's cookies to check that the
  // caller is a member of the workspace the install state names.
  const handleInstall = () => {
    window.location.href = API.github.appInstall(workspaceUrl)
  }

  // Same full-page round-trip as install: GitHub returns to the App callback,
  // which needs this session's cookies (LUM-881).
  const handleReverify = () => {
    window.location.href = API.github.appReverify(workspaceUrl)
  }

  const handleUninstall = async () => {
    await uninstallMutation.mutateAsync()
  }

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    uninstallOpen,
    setUninstallOpen,
    uninstalling: uninstallMutation.isPending,
    handleInstall,
    handleReverify,
    handleUninstall,
  }
}
