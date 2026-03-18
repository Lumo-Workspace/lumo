'use client';

import { X } from 'lucide-react';
import { motion } from 'motion/react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children, footer }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-[640px] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
        {footer && (
          <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-900 flex items-center justify-end">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  );
}
