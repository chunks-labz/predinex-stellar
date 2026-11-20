import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import PWAInstallPrompt, {
  PWA_INSTALL_DISMISSED_KEY,
  PWA_INSTALL_SNOOZE_MS,
} from '@/components/PWAInstallPrompt';

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
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

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

  it('remembers a dismissal across reloads', () => {
    const first = render(<PWAInstallPrompt />);
    fireBeforeInstallPrompt();
    fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }));
    first.unmount();

    // Browsers fire beforeinstallprompt again on the next page load.
    render(<PWAInstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.queryByRole('dialog', { name: /install predinex/i })).toBeNull();
  });

  it('offers the banner again once the snooze has expired', () => {
    localStorage.setItem(
      PWA_INSTALL_DISMISSED_KEY,
      String(Date.now() - PWA_INSTALL_SNOOZE_MS - 1)
    );
    render(<PWAInstallPrompt />);
    fireBeforeInstallPrompt();
    expect(screen.getByRole('dialog', { name: /install predinex/i })).toBeInTheDocument();
  });

  it('hides the banner even if the deferred prompt rejects', async () => {
    render(<PWAInstallPrompt />);
    const event = fireBeforeInstallPrompt();
    event.prompt.mockRejectedValue(new Error('already used'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });
    expect(screen.queryByRole('dialog', { name: /install predinex/i })).toBeNull();
  });
});
