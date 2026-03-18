import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string;
  initials?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'size-5 text-[8px]',
  md: 'size-7 text-[10px]',
  lg: 'size-10 text-[14px]',
};

export function Avatar({ src, initials, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={cn(
        'rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center font-bold overflow-hidden shrink-0',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt="avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
