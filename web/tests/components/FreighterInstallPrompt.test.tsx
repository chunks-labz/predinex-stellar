import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { FreighterInstallPrompt } from '@/components/wallet/FreighterInstallPrompt';

describe('FreighterInstallPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the install heading and description', () => {
    render(<FreighterInstallPrompt />);
    expect(screen.getByText('Freighter not detected')).toBeInTheDocument();
    expect(screen.getByText(/install the freighter browser extension/i)).toBeInTheDocument();
  });

  it('renders a link to freighter.app', () => {
    render(<FreighterInstallPrompt />);
    const link = screen.getByRole('link', { name: /install freighter/i });
    expect(link).toHaveAttribute('href', 'https://www.freighter.app/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('calls onRetry when "try again" button is clicked', () => {
    const onRetry = vi.fn();
    render(<FreighterInstallPrompt onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('reloads the page when no onRetry is provided', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(<FreighterInstallPrompt />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('has an accessible alert role', () => {
    render(<FreighterInstallPrompt />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('applies extra className if provided', () => {
    const { container } = render(<FreighterInstallPrompt className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
