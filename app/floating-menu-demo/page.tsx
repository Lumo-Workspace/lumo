'use client'

import HeadlessTipTapEditor from '@/components/headless-tiptap-editor'

export default function FloatingMenuDemo() {
  const handleUpdate = (content: string) => {
    console.log('Content updated:', content)
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='container mx-auto py-8'>
        <div className='bg-white rounded-lg shadow-lg'>
          <div className='p-6 border-b border-gray-200'>
            <h1 className='text-2xl font-bold text-gray-900'>
              悬浮菜单编辑器演示
            </h1>
            <p className='text-gray-600 mt-2'>
              选择文本后会显示悬浮菜单，包含各种格式化选项。编辑器顶部没有工具栏。
            </p>
          </div>
          <div className='h-96'>
            <HeadlessTipTapEditor
              content='<p>欢迎使用悬浮菜单编辑器！</p><p>请选择一些文本来查看悬浮菜单。</p><p>您可以尝试选择这段文字，然后使用悬浮菜单进行格式化。</p>'
              onUpdate={handleUpdate}
              placeholder='开始编写您的文档...'
              editable={true}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
