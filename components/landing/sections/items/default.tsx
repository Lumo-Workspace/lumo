import {
  AtSignIcon,
  BrainIcon,
  GitPullRequestIcon,
  KanbanIcon,
  MessageCircleQuestionIcon,
  ZapIcon,
} from 'lucide-react'
import { ReactNode } from 'react'

import { Item, ItemDescription, ItemIcon, ItemTitle } from '../../ui/item'
import { Section } from '../../ui/section'

interface ItemProps {
  title: string
  description: string
  icon: ReactNode
}

interface ItemsProps {
  title?: string
  items?: ItemProps[] | false
  className?: string
}

export default function Items({
  title = "Everything you need. Nothing you don't.",
  items = [
    {
      title: '@agent, assigned.',
      description:
        'Mention @agent on any task and it gets to work — pulls a branch, spins up a sandbox, starts executing. No setup. No ceremony.',
      icon: <AtSignIcon className='size-5 stroke-1' />,
    },
    {
      title: 'Asks before it guesses.',
      description:
        "When something's unclear, Agent pauses and asks. You reply, it continues. The decision always stays with you.",
      icon: <MessageCircleQuestionIcon className='size-5 stroke-1' />,
    },
    {
      title: 'Ships a real PR.',
      description:
        "Agent opens a pull request when it's done and moves the task into review. You review code, not prompts.",
      icon: <GitPullRequestIcon className='size-5 stroke-1' />,
    },
    {
      title: 'Memory that compounds.',
      description:
        'Agent remembers your conventions, code style, and past decisions. Every run gets smarter about your codebase.',
      icon: <BrainIcon className='size-5 stroke-1' />,
    },
    {
      title: 'For teams that build, not manage.',
      description:
        'No sprints. No velocity charts. No process for the sake of process. Just tasks and execution.',
      icon: <ZapIcon className='size-5 stroke-1' />,
    },
    {
      title: 'Your whole team, one board.',
      description:
        "Humans and agents collaborate on the same board. See who's on what — at a glance.",
      icon: <KanbanIcon className='size-5 stroke-1' />,
    },
  ],
  className,
}: ItemsProps) {
  return (
    <Section id='features' className={className}>
      <div className='max-w-container mx-auto flex flex-col items-center gap-6 sm:gap-20'>
        <h2 className='max-w-[560px] text-center text-3xl leading-tight font-semibold sm:text-5xl sm:leading-tight'>
          {title}
        </h2>
        {items !== false && items.length > 0 && (
          <div className='grid auto-rows-fr grid-cols-1 gap-0 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3'>
            {items.map((item, index) => (
              <Item key={index}>
                <ItemTitle className='flex items-center gap-2'>
                  <ItemIcon>{item.icon}</ItemIcon>
                  {item.title}
                </ItemTitle>
                <ItemDescription>{item.description}</ItemDescription>
              </Item>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}
