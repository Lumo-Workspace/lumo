'use client'

import HeadlessTipTapEditor from '@/components/headless-tiptap-editor'

export default function TestFloatingMenu() {
  return (
    <div className='min-h-screen bg-gray-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='bg-white rounded-lg shadow-lg p-6'>
          <h1 className='text-2xl font-bold mb-4'>悬浮菜单测试</h1>
          <p className='text-gray-600 mb-6'>
            请选择下面的文本来测试悬浮菜单功能：
          </p>

          <div
            className='border rounded-lg bg-gray-50'
            style={{ height: '400px' }}
          >
            <HeadlessTipTapEditor
              content='<p>这是一个测试文档。请选择任何文本来查看悬浮菜单。</p><p>你可以尝试选择这段文字，然后使用悬浮菜单进行格式化。</p><p>悬浮菜单应该出现在选中文本的上方。</p>'
              onUpdate={_content => {
                // 内容更新回调
              }}
              placeholder='开始编写...'
              editable={true}
            />
          </div>

          <div className='mt-4 text-sm text-gray-500'>
            <p>调试信息：在开发模式下，右下角会显示调试信息</p>
          </div>
        </div>
      </div>
    </div>
  )
}
