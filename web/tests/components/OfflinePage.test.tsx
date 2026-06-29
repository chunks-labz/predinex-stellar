import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import OfflinePage from '../../app/offline/page';

describe('OfflinePage', () => {
  afterEach(() => cleanup());

  it('renders the offline fallback message', () => {
    render(<OfflinePage />);
    expect(screen.getByRole('heading', { name: /you're offline/i })).toBeInTheDocument();
    expect(screen.getByText(/can't reach the network/i)).toBeInTheDocument();
  });

  it('reloads the page when "Try again" is clicked', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(<OfflinePage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
