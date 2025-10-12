'use client'

interface ContextMenuProps {
  show: boolean
  position: { x: number; y: number }
  onRename: () => void
  onDelete: () => void
}

export default function ContextMenu({
  show,
  position,
  onRename,
  onDelete,
}: ContextMenuProps) {
  if (!show) return null

  return (
    <div
      className='fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-2 min-w-40 backdrop-blur-sm'
      style={{ left: position.x, top: position.y }}
    >
      <button
        onClick={onRename}
        className='w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700'
      >
        重命名
      </button>
      <button
        onClick={onDelete}
        className='w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-500'
      >
        删除
      </button>
    </div>
  )
}
