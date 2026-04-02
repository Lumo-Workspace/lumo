import { ReactNode } from 'react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../ui/accordion'
import { Section } from '../../ui/section'

interface FAQItemProps {
  question: string
  answer: ReactNode
  value?: string
}

interface FAQProps {
  title?: string
  items?: FAQItemProps[] | false
  className?: string
}

export default function FAQ({
  title = 'Questions and Answers',
  items = [
    {
      question:
        'Is Lumo just another AI chat assistant for project management?',
      answer: (
        <p className='text-muted-foreground max-w-[640px] text-balance'>
          No. Most AI tools help you manage work. Lumo&apos;s agent actually
          does the work — it picks up tasks, writes code in an isolated
          environment, and opens a real PR. You review output, not prompts.
        </p>
      ),
    },
    {
      question: 'How does the agent know what to build?',
      answer: (
        <p className='text-muted-foreground max-w-[640px] text-balance'>
          You assign a task to @agent like you would any teammate. It reads the
          task description, pulls in context from your docs, Figma files, and
          codebase, and asks clarifying questions before it starts — not after.
        </p>
      ),
    },
    {
      question: 'What if the agent gets stuck or makes a wrong assumption?',
      answer: (
        <p className='text-muted-foreground max-w-[640px] text-balance'>
          It pauses and asks. Agent will never silently guess on something
          ambiguous. You reply in the task thread, it picks back up exactly
          where it left off.
        </p>
      ),
    },
    {
      question: 'Is my codebase safe?',
      answer: (
        <p className='text-muted-foreground max-w-[640px] text-balance'>
          Every task runs in a fully isolated execution environment. The agent
          can&apos;t touch your main branch — nothing ships until you approve
          the PR.
        </p>
      ),
    },
    {
      question: 'How is Lumo different from GitHub Copilot or Cursor?',
      answer: (
        <p className='text-muted-foreground max-w-[640px] text-balance'>
          Those are coding assistants for individual developers. Lumo is a team
          tool — tasks, assignments, reviews, and agent execution all live in
          one place. Your whole team sees what the agent is working on, just
          like any other teammate.
        </p>
      ),
    },
    {
      question: 'When is Lumo available?',
      answer: (
        <p className='text-muted-foreground max-w-[640px] text-balance'>
          We&apos;re currently in early access. Join the waitlist and we&apos;ll
          reach out when your spot is ready.
        </p>
      ),
    },
  ],
  className,
}: FAQProps) {
  return (
    <Section id='faq' className={className}>
      <div className='max-w-container mx-auto flex flex-col items-center gap-8'>
        <h2 className='text-center text-3xl font-semibold sm:text-5xl'>
          {title}
        </h2>
        {items !== false && items.length > 0 && (
          <Accordion type='single' collapsible className='w-full max-w-[800px]'>
            {items.map((item, index) => (
              <AccordionItem
                key={index}
                value={item.value || `item-${index + 1}`}
              >
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </Section>
  )
}
