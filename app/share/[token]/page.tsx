import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'
import { withShareToken } from '@/lib/files/private-file-path'
import { richHtmlToReact } from '@/lib/html/rich-html-to-react'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function PublicDocumentPage({ params }: PageProps) {
  const { token } = await params

  const document = await prisma.document.findUnique({
    where: { publicToken: token },
    select: {
      title: true,
      emoji: true,
      content: true,
    },
  })

  if (!document) {
    notFound()
  }

  return (
    <div className='min-h-screen bg-background'>
      <div className='max-w-3xl mx-auto px-8 py-12'>
        <h1 className='text-display mb-8'>
          {document.emoji ? `${document.emoji} ` : ''}
          {document.title || 'Untitled'}
        </h1>
        {document.content ? (
          // LUM-916: sanitized, then built as React elements (no innerHTML);
          // embedded (private) images get this page's share token.
          <div className='prose prose-sm dark:prose-invert max-w-none'>
            {richHtmlToReact(document.content, {
              transformUrl: url => withShareToken(url, token),
            })}
          </div>
        ) : (
          <p className='text-muted-foreground'>No content</p>
        )}
      </div>
    </div>
  )
}
