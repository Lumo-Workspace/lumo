import { ReactNode } from 'react'

import Claude from '../../logos/claude'
import Figma from '../../logos/figma'
import Github from '../../logos/github'
import GoogleDrive from '../../logos/google-drive'
import Notion from '../../logos/notion'
import Slack from '../../logos/slack'
import Logo from '../../ui/logo'
import { Section } from '../../ui/section'

interface LogosProps {
  title?: string
  badge?: ReactNode | false
  logos?: ReactNode[] | false
  className?: string
}

export default function Logos({
  title = 'Works with your favorite tools',
  badge = false,
  logos = [
    <Logo key='github' image={Github} name='GitHub' />,
    <Logo key='slack' image={Slack} name='Slack' />,
    <Logo key='notion' image={Notion} name='Notion' />,
    <Logo key='figma' image={Figma} name='Figma' />,
    <Logo key='claude' image={Claude} name='Claude Code' />,
    <Logo key='gdrive' image={GoogleDrive} name='Google Drive' />,
  ],
  className,
}: LogosProps) {
  return (
    <Section className={className}>
      <div className='max-w-container mx-auto flex flex-col items-center gap-8 text-center'>
        <div className='flex flex-col items-center gap-6'>
          {badge !== false && badge}
          <h2 className='text-md font-semibold sm:text-2xl'>{title}</h2>
        </div>
        {logos !== false && logos.length > 0 && (
          <div className='flex flex-wrap items-center justify-center gap-8'>
            {logos}
          </div>
        )}
      </div>
    </Section>
  )
}
