'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

interface WorkspaceContextValue {
  currentDocumentId: string | null
  setCurrentDocumentId: (documentId: string | null) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(
    null
  )

  return (
    <WorkspaceContext.Provider
      value={{ currentDocumentId, setCurrentDocumentId }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return context
}
