'use client';

import { useI18n } from '@/app/lib/i18n';

interface EmptyStateProps {
  /** Optional override message. Falls back to the i18n default. */
  message?: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  const { t } = useI18n();
  return <p>{message ?? t('emptyState.defaultMessage')}</p>;
}
