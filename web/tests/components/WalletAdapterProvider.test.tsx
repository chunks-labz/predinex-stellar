import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ── Freighter adapter mock ────────────────────────────────────────────────────

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
let mockStateCallback: ((patch: Record<string, unknown>) => void) | null = null;

vi.mock('@/app/lib/freighter-adapter', () => ({
  isFreighterInstalled: vi.fn(() => true),
  createFreighterAdapter: vi.fn((cb: (patch: Record<string, unknown>) => void) => {
    mockStateCallback = cb;
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
    };
  }),
}));

// Import after mocks are set up
import { WalletAdapterProvider, useWallet } from '@/components/WalletAdapterProvider';
import { isFreighterInstalled } from '@/app/lib/freighter-adapter';

// ── Helper consumer component ─────────────────────────────────────────────────

function WalletConsumer() {
  const { address, isConnected, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="address">{address ?? 'none'}</span>
      <span data-testid="connected">{String(isConnected)}</span>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletAdapterProvider>
      <WalletConsumer />
    </WalletAdapterProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WalletAdapterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockStateCallback = null;
    // Default: connect resolves without calling the state callback
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts disconnected when no persisted address', () => {
    renderWithProvider();
    expect(screen.getByTestId('connected').textContent).toBe('false');
    expect(screen.getByTestId('address').textContent).toBe('none');
  });

  it('calls connect() on mount when a persisted connection flag exists and Freighter is installed', async () => {
    localStorage.setItem('predinex:wallet:connected', 'true');
    vi.mocked(isFreighterInstalled).mockReturnValue(true);

    renderWithProvider();

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  it('calls connect() on mount when legacy persisted address exists and purges it', async () => {
    localStorage.setItem('predinex:wallet:address', 'GCTEST123');
    vi.mocked(isFreighterInstalled).mockReturnValue(true);

    renderWithProvider();

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT call connect() on mount when Freighter is NOT installed', async () => {
    localStorage.setItem('predinex:wallet:connected', 'true');
    vi.mocked(isFreighterInstalled).mockReturnValue(false);

    renderWithProvider();

    // Give a tick for useEffect
    await act(async () => {});
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('persists connected flag and NOT plaintext address in localStorage when state patch includes an address', async () => {
    renderWithProvider();
    await act(async () => {});

    // Simulate adapter state change (successful connect)
    await act(async () => {
      mockStateCallback?.({ address: 'GCABC456', isConnected: true, isLoading: false });
    });

    expect(localStorage.getItem('predinex:wallet:connected')).toBe('true');
    expect(localStorage.getItem('predinex:wallet:address')).toBeNull();
    expect(screen.getByTestId('address').textContent).toBe('GCABC456');
    expect(screen.getByTestId('connected').textContent).toBe('true');
  });

  it('clears localStorage when disconnect() is called', async () => {
    localStorage.setItem('predinex:wallet:connected', 'true');
    localStorage.setItem('predinex:wallet:address', 'GCABC456');
    renderWithProvider();
    await act(async () => {});

    // Simulate connected state
    await act(async () => {
      mockStateCallback?.({ address: 'GCABC456', isConnected: true, isLoading: false });
    });

    await userEvent.click(screen.getByRole('button', { name: 'disconnect' }));

    expect(localStorage.getItem('predinex:wallet:connected')).toBeNull();
    expect(localStorage.getItem('predinex:wallet:address')).toBeNull();
  });

  it('clears localStorage when adapter patches address to null', async () => {
    localStorage.setItem('predinex:wallet:connected', 'true');
    localStorage.setItem('predinex:wallet:address', 'GCABC456');
    renderWithProvider();
    await act(async () => {});

    await act(async () => {
      mockStateCallback?.({ address: null, isConnected: false });
    });

    expect(localStorage.getItem('predinex:wallet:connected')).toBeNull();
    expect(localStorage.getItem('predinex:wallet:address')).toBeNull();
    expect(screen.getByTestId('address').textContent).toBe('none');
  });

  it('removes stale persisted connection flag when connect() rejects', async () => {
    localStorage.setItem('predinex:wallet:connected', 'true');
    localStorage.setItem('predinex:wallet:address', 'GCSTALE');
    vi.mocked(isFreighterInstalled).mockReturnValue(true);
    mockConnect.mockRejectedValue(new Error('extension rejected'));

    renderWithProvider();

    await waitFor(() => {
      expect(localStorage.getItem('predinex:wallet:connected')).toBeNull();
      expect(localStorage.getItem('predinex:wallet:address')).toBeNull();
    });
  });
});
