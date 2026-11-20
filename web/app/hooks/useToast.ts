/**
 * Toast Hook - Issue #1533
 */

import { useState, useCallback } from 'react';
import type { ToastProps } from '../../components/ui/Toast';

export const useToast = () => {
  const [toasts, setToasts] = useState<Array<ToastProps & { id: string }>>([]);

  const showToast = useCallback((toast: Omit<ToastProps, 'onClose'>) => {
    const id = Math.random().toString(36);
    setToasts((prev) => [...prev, { ...toast, id, onClose: () => removeToast(id) }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, removeToast };
};
