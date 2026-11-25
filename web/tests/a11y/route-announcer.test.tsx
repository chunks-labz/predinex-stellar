import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import RouteAnnouncer from '../../components/RouteAnnouncer';
import { I18nProvider } from '../../app/lib/i18n';

const { mockPathname } = vi.hoisted(() => ({ mockPathname: { current: '/' } }));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderRoute(title: string) {
  return render(
    <I18nProvider>
      <RouteAnnouncer />
      <div id="main-content">
        <main>
          <h1>{title}</h1>
        </main>
      </div>
    </I18nProvider>
  );
}

describe('RouteAnnouncer', () => {
  beforeEach(() => {
    mockPathname.current = '/';
  });

  afterEach(() => cleanup());

  it('does not announce or move focus on the initial render', () => {
    renderRoute('Home');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('announces the page title and focuses the main heading after navigation', async () => {
    const { rerender } = renderRoute('Home');
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');

    mockPathname.current = '/transactions';
    rerender(
      <I18nProvider>
        <RouteAnnouncer />
        <div id="main-content">
          <main>
            <h1>Transaction History</h1>
          </main>
        </div>
      </I18nProvider>
    );

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Navigated to: Transaction History');
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(heading);
  });

  it('has no serious accessibility violations', async () => {
    const { container } = renderRoute('Markets');
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
    const serious = results.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious'
    );
    expect(serious, `Violations: ${JSON.stringify(serious.map((v) => v.id))}`).toHaveLength(0);
  });
});
