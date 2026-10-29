import { redirect } from 'next/navigation'
import { LEGACY_SETTINGS_REDIRECTS, settingsUrl } from '../settings-nav'

/** LUM-1339 — moved; kept so old links and bookmarks still land. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceUrl: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceUrl } = await params
  redirect(
    settingsUrl(
      workspaceUrl,
      LEGACY_SETTINGS_REDIRECTS['api-keys'],
      await searchParams
    )
  )
}
