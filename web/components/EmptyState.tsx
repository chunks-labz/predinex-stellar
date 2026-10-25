'use client';

import React from 'react';
import Link from 'next/link';
import { useI18n } from '@/app/lib/i18n';
import { FolderOpen } from 'lucide-react';

export interface EmptyStateProps {
  /** Optional override message or description. Falls back to i18n default if neither title nor description provided. */
  message?: string;
  /** Primary title for the empty state */
  title?: string;
  /** Explanatory description */
  description?: string;
  /** Custom icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** Primary action button label */
  actionLabel?: string;
  /** Primary action link destination */
  actionHref?: string;
  /** Primary action click handler */
  onAction?: () => void;
  /** Secondary action button label */
  secondaryActionLabel?: string;
  /** Secondary action click handler */
  onSecondaryAction?: () => void;
  /** Additional container classes */
  className?: string;
}

export function EmptyState({
  message,
  title,
  description,
  icon: Icon = FolderOpen,
  actionLabel,
  actionHref,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}: EmptyStateProps) {
  const { t } = useI18n();

  const displayTitle = title || (message ? undefined : undefined);
  const displayDescription = description || message || t('emptyState.defaultMessage');

  return (
    <div
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm shadow-sm ${className}`}
      role="status"
    >
      <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-5 text-muted-foreground ring-1 ring-border/20 shadow-inner">
        <Icon className="w-8 h-8" />
      </div>

      {displayTitle && (
        <h3 className="text-xl font-bold tracking-tight text-foreground mb-2">
          {displayTitle}
        </h3>
      )}

      {displayDescription && (
        <p className="text-sm sm:text-base text-muted-foreground max-w-md mb-6 leading-relaxed">
          {displayDescription}
        </p>
      )}

      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-xl border border-border/60 bg-background/50 hover:bg-muted/80 text-foreground transition-all duration-200 cursor-pointer shadow-xs"
            >
              {secondaryActionLabel}
            </button>
          )}

          {actionLabel && actionHref && (
            <Link
              href={actionHref}
              className="inline-flex items-center justify-center px-5 py-2 text-sm font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200 shadow-sm hover:shadow"
            >
              {actionLabel}
            </Link>
          )}

          {actionLabel && !actionHref && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center justify-center px-5 py-2 text-sm font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200 cursor-pointer shadow-sm hover:shadow"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
