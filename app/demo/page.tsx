import MarkdownEditor from '@/components/core/editor/markdown/MarkdownEditor'

// Demo workspace page - no authentication required
export default function DemoWorkspacePage() {
  return (
    <div className='min-h-screen bg-white'>
      <MarkdownEditor />
    </div>
  )
}
