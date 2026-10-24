/**
 * Enhanced Toast Notification Component
 * Issue #1533: Improve prediction market UX - iteration 3
 */

import React, { useEffect } from 'react';

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  duration = 5000,
  onClose,
  action,
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const typeStyles = {
    success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
  };

  const icons = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
  };

  return (
    <div
      className={`${typeStyles[type]} border rounded-lg shadow-lg p-4 flex items-center gap-3 animate-slide-in-right max-w-md`}
      role="alert"
    >
      <span className="text-2xl flex-shrink-0">{icons[type]}</span>
      <p className="flex-1 text-sm font-medium">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="text-sm font-semibold underline hover:no-underline"
        >
          {action.label}
        </button>
      )}
      {onClose && (
        <button
          onClick={onClose}
          className="text-2xl leading-none hover:opacity-70"
          aria-label="Close"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default Toast;
