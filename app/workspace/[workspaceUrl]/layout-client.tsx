'use client'

interface WorkspaceLayoutClientProps {
  workspaceUrl: string
  workspaceId: string
  children: React.ReactNode
}

export function WorkspaceLayoutClient({
  children,
}: WorkspaceLayoutClientProps) {
  return <>{children}</>
}
