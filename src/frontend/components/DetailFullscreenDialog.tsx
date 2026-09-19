import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface DetailFullscreenDialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const DetailFullscreenDialog: React.FC<DetailFullscreenDialogProps> = ({ isOpen, title, onClose, children }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`${title} in Großansicht`}>
      <section className="w-full max-w-6xl h-[min(90vh,900px)] bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-2xl flex flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 p-4 border-b border-stone-200 dark:border-stone-800">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="Großansicht schließen">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-stone-50 dark:bg-stone-950/30">
          {children}
        </div>
      </section>
    </div>
  );
};
