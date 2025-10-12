import { Placeholder } from '@tiptap/extension-placeholder'

// 自定义占位符扩展，为不同类型的节点提供不同的占位符文本
export const CustomPlaceholder = Placeholder.configure({
  placeholder: ({ node }) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level
      switch (level) {
        case 1:
          return '输入标题...'
        case 2:
          return '输入二级标题...'
        case 3:
          return '输入三级标题...'
        case 4:
          return '输入四级标题...'
        case 5:
          return '输入五级标题...'
        case 6:
          return '输入六级标题...'
        default:
          return '输入标题...'
      }
    }

    if (node.type.name === 'paragraph') {
      return '开始输入内容...'
    }

    return '输入内容...'
  },

  showOnlyWhenEditable: true,
  showOnlyCurrent: false,
})

export default CustomPlaceholder
