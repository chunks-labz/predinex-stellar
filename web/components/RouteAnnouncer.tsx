'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/app/lib/i18n';

function titleFromPath(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean).pop();
  if (!segment) return 'Home';

  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }

  return decoded
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function RouteAnnouncer() {
  const pathname = usePathname();
  const { t } = useI18n();
  const previousPath = useRef(pathname);
  const liveRegion = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    const main = document.getElementById('main-content');
    const heading = main?.querySelector<HTMLElement>('h1');
    const target = heading ?? main;
    const pageTitle = heading?.textContent?.trim() || titleFromPath(pathname);

    if (liveRegion.current) {
      liveRegion.current.textContent = `${t('a11y.routeAnnouncement')} ${pageTitle}`;
    }

    if (target) {
      if (target.tabIndex < 0) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }, [pathname, t]);

  return (
    <div
      ref={liveRegion}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );
}
