'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast, { ToastType } from '../components/ui/Toast';

interface ToastMessage {
    id: string;
    message: string;
    type?: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/*
             * #458 a11y: aria-live region for screen reader announcements.
             * Individual Toast components also carry role/aria-live for
             * assertive (error) vs polite (others) announcements.
             */}
            <div
                aria-label="Notifications"
                className="fixed bottom-0 right-0 p-4 z-[100] flex flex-col gap-2 pointer-events-none"
            >
                {toasts.map((toast) => (
                    <div key={toast.id} className="pointer-events-auto">
                        <Toast
                            message={toast.message}
                            type={toast.type}
                            onClose={() => removeToast(toast.id)}
                        />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}
