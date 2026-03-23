import { SettingsShell } from './SettingsShell'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceUrl: string }>
}) {
  const { workspaceUrl } = await params
  return <SettingsShell workspaceUrl={workspaceUrl}>{children}</SettingsShell>
}
