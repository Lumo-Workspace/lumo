'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { legacyWorkspaceTarget, settingsUrl } from '../settings-nav'

/**
 * LUM-1339 — the old single Workspace page. Its groups each have a page now;
 * the anchor (only the browser sees it) picks which one, so links in sent
 * mails and notices still land on the right page.
 */
export default function LegacyWorkspaceSettingsPage() {
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  useEffect(() => {
    router.replace(
      settingsUrl(workspaceUrl, legacyWorkspaceTarget(window.location.hash))
    )
  }, [])
  return null
}
