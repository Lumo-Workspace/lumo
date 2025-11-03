import DemoWorkspace from '@/components/core/editor/demo-workspace/DemoWorkspace'

// Demo workspace page - no authentication required
export default function DemoWorkspacePage() {
  return (
    <div className='min-h-screen bg-white'>
      <DemoWorkspace />
    </div>
  )
}
