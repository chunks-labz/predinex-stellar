'use client';

import { ReactNode, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../app/lib/hooks/useFocusTrap';
import { useEscapeDismiss } from '../../app/lib/hooks/useEscapeDismiss';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  closeOnEscape?: boolean;
  closeOnBackdropClick?: boolean;
  showCloseButton?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg';
}

const MAX_WIDTH_CLASS: Record<NonNullable<DialogProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  closeOnEscape = true,
  closeOnBackdropClick = true,
  showCloseButton = true,
  maxWidth = 'md',
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap({ active: open, containerRef });
  useEscapeDismiss({
    active: open && closeOnEscape,
    onDismiss: onClose,
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 animate-in fade-in duration-200"
      onClick={() => {
        if (closeOnBackdropClick) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`glass border border-border rounded-2xl p-6 w-full ${MAX_WIDTH_CLASS[maxWidth]} max-h-[90vh] overflow-y-auto outline-none animate-in zoom-in-95 duration-200`}
      >
        <div className="flex justify-between items-start mb-4">
          <div className="min-w-0 flex-1 pr-4">
            <h2 id={titleId} className="text-xl font-bold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 -m-2 rounded-lg hover:bg-muted transition-colors"
              aria-label={`Close ${title}`}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
