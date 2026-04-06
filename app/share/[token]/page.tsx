import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/prisma'

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
        <h1 className='text-3xl font-bold mb-8'>
          {document.emoji ? `${document.emoji} ` : ''}
          {document.title || 'Untitled'}
        </h1>
        {document.content ? (
          <div
            className='prose prose-sm dark:prose-invert max-w-none'
            dangerouslySetInnerHTML={{ __html: document.content }}
          />
        ) : (
          <p className='text-muted-foreground'>No content</p>
        )}
      </div>
    </div>
  )
}
