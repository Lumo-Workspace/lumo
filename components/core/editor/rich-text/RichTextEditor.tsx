'use client'

import './RichTextEditor.scss'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CustomDocument } from '../tiptap/extensions/custom-document'
import { CustomPlaceholder } from '../tiptap/extensions/custom-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import { TextStyle, TextStyleKit } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { useEffect, useRef } from 'react'
import { TableOfContents as TableOfContentsExtension } from '../../../../extensions/table-of-contents'
import { RichTextEditorLayout } from './RichTextEditorLayout'
import { RichTextEditorLoader } from './RichTextEditorLoader'
import {
  useEditorContentSync,
  useEditorEditableSync,
  useEnsureFirstLineH1,
} from './RichTextEditorHooks'

interface HeadlessTipTapEditorProps {
  content?: string | any // HTML string or TipTap JSON
  onUpdate?: (_content: string) => void // Returns HTML
  onUpdateJSON?: (_content: any) => void // Returns TipTap JSON
  placeholder?: string
  editable?: boolean
  className?: string
  documentId?: string | null
}

export default function HeadlessTipTapEditor({
  content = '',
  onUpdate,
  onUpdateJSON,
  editable = true,
  className = '',
  documentId: _documentId,
}: HeadlessTipTapEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      CustomDocument, // 使用自定义文档扩展，确保始终有标题
      TextStyleKit,
      StarterKit.configure({
        // 配置 StarterKit 中的扩展
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
        },
        code: {
          HTMLAttributes: {
            class: 'bg-gray-100 px-1 py-0.5 rounded text-sm font-mono',
          },
        },
        codeBlock: {
          HTMLAttributes: {
            class: 'bg-gray-100 p-4 rounded-lg font-mono text-sm',
          },
        },
      }),
      CustomPlaceholder, // 使用自定义占位符扩展
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https'],
        HTMLAttributes: {
          class: 'text-blue-500 hover:text-blue-700 underline cursor-pointer',
          rel: 'noopener noreferrer nofollow',
        },
        isAllowedUri: (url, ctx) => {
          try {
            // construct URL
            const parsedUrl = url.includes(':')
              ? new URL(url)
              : new URL(`${ctx.defaultProtocol}://${url}`)

            // use default validation
            if (!ctx.defaultValidate(parsedUrl.href)) {
              return false
            }

            // disallowed protocols
            const disallowedProtocols = ['ftp', 'file', 'mailto']
            const protocol = parsedUrl.protocol.replace(':', '')

            if (disallowedProtocols.includes(protocol)) {
              return false
            }

            // only allow protocols specified in ctx.protocols
            const allowedProtocols = ctx.protocols.map(p =>
              typeof p === 'string' ? p : p.scheme
            )

            if (!allowedProtocols.includes(protocol)) {
              return false
            }

            // all checks have passed
            return true
          } catch {
            return false
          }
        },
        shouldAutoLink: url => {
          try {
            // construct URL
            const parsedUrl = url.includes(':')
              ? new URL(url)
              : new URL(`https://${url}`)

            // basic validation for autolink
            return parsedUrl.hostname.length > 0
          } catch {
            return false
          }
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
        },
      }),
      Typography,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Color,
      TextStyle,
      Underline,
      Highlight.configure({
        multicolor: true,
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'task-list',
        },
      }),
      TaskItem.configure({
        HTMLAttributes: {
          class: 'task-item',
        },
        nested: true,
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse border border-gray-300',
        },
      }),
      TableRow.configure({
        HTMLAttributes: {
          class: 'border border-gray-300',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-gray-300 px-4 py-2',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-gray-300 px-4 py-2 bg-gray-50 font-semibold',
        },
      }),
      HorizontalRule.configure({
        HTMLAttributes: {
          class: 'my-8 border-t-2 border-gray-300',
        },
      }),
      TableOfContentsExtension,
    ],
    content,
    editable,
    onUpdate: ({ editor }: { editor: any }) => {
      const html = editor.getHTML()
      const json = editor.getJSON()
      onUpdate?.(html)
      onUpdateJSON?.(json)
    },
    editorProps: {
      attributes: {
        class: `prose prose-lg max-w-none focus:outline-none ${className}`,
        style: 'min-height: 200px; padding: 16px; cursor: text;',
      },
    },
  })

  // Custom hooks for editor state management
  useEditorContentSync(editor, content)
  useEditorEditableSync(editor, editable)
  useEnsureFirstLineH1(editor)

  // 清理编辑器实例
  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  if (!editor) {
    return <RichTextEditorLoader />
  }

  return <RichTextEditorLayout editor={editor} editorRef={editorRef} />
}

// 导出编辑器方法类型，供父组件使用
export type EditorMethods = {
  focus: () => void
  clearContent: () => void
  insertContent: (_content: string) => void
  getHTML: () => string
  getText: () => string
  getJSON: () => any
  isEmpty: () => boolean
  isActive: (_name: string, _attributes?: Record<string, any>) => boolean
}
