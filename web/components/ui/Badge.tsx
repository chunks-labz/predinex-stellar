import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'outline';

interface BadgeProps {
    children: ReactNode;
    variant?: BadgeVariant;
    className?: string;
}

/**
 * Badge - Generic tag component
 * @param children Badge content
 * @param variant Visual style variant
 * @param className Additional CSS classes
 */
export default function Badge({
    children,
    variant = 'default',
    className = ''
}: BadgeProps) {
    const variantClasses = {
        default: 'bg-muted/80 text-foreground border-border',
        primary: 'bg-primary/20 text-primary-foreground border-primary/40',
        success: 'bg-green-500/20 text-green-200 border-green-400/40',
        warning: 'bg-orange-500/20 text-orange-200 border-orange-400/40',
        error: 'bg-red-500/20 text-red-200 border-red-400/40',
        outline: 'bg-transparent text-foreground border-border',
    };

    return (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${variantClasses[variant]} ${className}`}>
            {children}
        </span>
    );
}
