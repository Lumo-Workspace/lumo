'use client'

import React, { useState } from 'react'

type Json = Record<string, any>

export default function DocsTesterPage() {
  const [workspaceId, setWorkspaceId] = useState('')
  const [title, setTitle] = useState('Test Doc')
  const [content, setContent] = useState<string>(
    JSON.stringify(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello TipTap' }],
          },
        ],
      },
      null,
      2
    )
  )
  const [documentId, setDocumentId] = useState('')
  const [path, setPath] = useState('')
  const [result, setResult] = useState<Json | string>('')

  async function call(method: string, url: string, body?: any) {
    setResult('Loading...')
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      try {
        const json = JSON.parse(text)
        setResult(json)
      } catch {
        setResult(text)
      }
    } catch (e: any) {
      setResult(String(e?.message || e))
    }
  }

  return (
    <div className='p-6 space-y-4'>
      <h1 className='text-xl font-semibold'>Documents API Tester</h1>
      <div className='grid gap-2 max-w-3xl'>
        <label className='grid gap-1'>
          <span>workspaceId</span>
          <input
            className='border px-2 py-1'
            value={workspaceId}
            onChange={e => setWorkspaceId(e.target.value)}
            placeholder='ws_...'
          />
        </label>
        <label className='grid gap-1'>
          <span>title</span>
          <input
            className='border px-2 py-1'
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </label>
        <label className='grid gap-1'>
          <span>content (TipTap JSON)</span>
          <textarea
            className='border px-2 py-1 font-mono'
            rows={8}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
        </label>
        <label className='grid gap-1'>
          <span>documentId</span>
          <input
            className='border px-2 py-1'
            value={documentId}
            onChange={e => setDocumentId(e.target.value)}
            placeholder='doc_...'
          />
        </label>
        <label className='grid gap-1'>
          <span>path</span>
          <input
            className='border px-2 py-1'
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder='/my-doc'
          />
        </label>
      </div>

      <div className='flex flex-wrap gap-2'>
        <button
          className='border px-3 py-1'
          onClick={() =>
            call('POST', '/api/documents', {
              workspaceId,
              title,
              content: JSON.parse(content),
            })
          }
        >
          Create
        </button>

        <button
          className='border px-3 py-1'
          onClick={() =>
            call(
              'GET',
              `/api/documents?workspaceId=${encodeURIComponent(workspaceId)}`
            )
          }
        >
          List
        </button>

        <button
          className='border px-3 py-1'
          onClick={() =>
            call('GET', `/api/documents/${encodeURIComponent(documentId)}`)
          }
        >
          Get by ID
        </button>

        <button
          className='border px-3 py-1'
          onClick={() =>
            call(
              'GET',
              `/api/documents/by-path?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`
            )
          }
        >
          Get by Path
        </button>

        <button
          className='border px-3 py-1'
          onClick={() =>
            call('PATCH', `/api/documents/${encodeURIComponent(documentId)}`, {
              title,
              content: JSON.parse(content),
            })
          }
        >
          Update
        </button>

        <button
          className='border px-3 py-1'
          onClick={() =>
            call('DELETE', `/api/documents/${encodeURIComponent(documentId)}`)
          }
        >
          Delete
        </button>
      </div>

      <div className='mt-4'>
        <h2 className='font-medium'>Result</h2>
        <pre className='border p-3 bg-white text-sm overflow-auto'>
          {typeof result === 'string'
            ? result
            : JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  )
}
