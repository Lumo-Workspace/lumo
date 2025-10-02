"use client"
import { Button } from "@/components/ui/button"

interface DeleteDialogProps {
  show: boolean
  pageTitle: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteDialog({ show, pageTitle, onConfirm, onCancel }: DeleteDialogProps) {
  if (!show) return null

  return (
    <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center bg-black/50 z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold mb-2 text-gray-900">删除页面</h3>
        <p className="text-gray-600 mb-6">
          确定要删除「{pageTitle}」吗？此操作无法撤销，页面及其所有子页面都将被永久删除。
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white">
            删除
          </Button>
        </div>
      </div>
    </div>
  )
}
