import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';

interface MockPromptEvent extends Event {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as MockPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('PWAInstallPrompt', () => {
  afterEach(() => cleanup());

  it('stays hidden until the browser offers an install prompt', () => {
    render(<PWAInstallPrompt />);
    expect(screen.queryByRole('dialog', { name: /install predinex/i })).toBeNull();
  });

  it('shows the install banner when beforeinstallprompt fires', () => {
    render(<PWAInstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.getByRole('dialog', { name: /install predinex/i })).toBeInTheDocument();
  });

  it('invokes the deferred prompt when Install is clicked', async () => {
    render(<PWAInstallPrompt />);
    const event = fireBeforeInstallPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /install predinex/i })).toBeNull();
  });

  it('can be dismissed without installing', () => {
    render(<PWAInstallPrompt />);
    fireBeforeInstallPrompt();

    fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }));
    expect(screen.queryByRole('dialog', { name: /install predinex/i })).toBeNull();
  });
});
