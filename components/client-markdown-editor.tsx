"use client"

import dynamic from "next/dynamic"

const MarkdownEditor = dynamic(() => import("./markdown-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen bg-gray-50 text-gray-800 items-center justify-center">
      <div className="text-center">
        <div className="animate-pulse">
          <div className="h-16 w-16 bg-gray-200 rounded-full mx-auto mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-48 mx-auto mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-64 mx-auto"></div>
        </div>
      </div>
    </div>
  ),
})

interface ClientMarkdownEditorProps {}

export default function ClientMarkdownEditor({}: ClientMarkdownEditorProps) {
  return <MarkdownEditor />
}
