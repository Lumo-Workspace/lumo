'use client';

import { Home, Layers, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Page } from '../types';

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  shortcut?: string;
}

function SidebarItem({ icon: Icon, label, active, onClick, shortcut }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-md transition-all duration-200',
        active
          ? 'bg-zinc-100 text-zinc-900 font-semibold dark:bg-zinc-800 dark:text-zinc-50'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900',
      )}
    >
      <div className="flex items-center gap-3">
        <Icon size={20} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      {shortcut && <span className="text-[10px] text-zinc-400 font-mono">{shortcut}</span>}
    </button>
  );
}

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Sidebar({ currentPage, onNavigate, isDarkMode, onToggleDarkMode }: SidebarProps) {
  return (
    <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-4 mb-2 flex items-center gap-3">
        <div className="size-8 bg-zinc-900 dark:bg-zinc-100 rounded flex items-center justify-center text-white dark:text-zinc-900">
          <Layers size={20} />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Lumo</h1>
          <p className="text-[11px] text-zinc-500 font-medium">Engineering OS</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        <div className="mb-4">
          <SidebarItem
            icon={Home}
            label="My Tasks"
            active={currentPage === 'my-tasks'}
            onClick={() => onNavigate('my-tasks')}
            shortcut="⌘1"
          />
        </div>
        <div className="space-y-1">
          <p className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
            Workspace
          </p>
          <SidebarItem
            icon={Layers}
            label="Projects"
            active={currentPage === 'projects' || currentPage === 'project-detail'}
            onClick={() => onNavigate('projects')}
          />
        </div>
      </nav>

      {/* Footer */}
      <div className="p-3 mt-auto border-t border-zinc-200 dark:border-zinc-800">
        <SidebarItem
          icon={isDarkMode ? Sparkles : Settings}
          label={isDarkMode ? 'Dark Mode' : 'Settings'}
          onClick={onToggleDarkMode}
        />
      </div>
    </aside>
  );
}
