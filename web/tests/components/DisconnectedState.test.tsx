import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisconnectedState } from '../../components/DisconnectedState';
import { renderWithProviders } from '../helpers/renderWithProviders';
import { useWallet } from '@/components/WalletAdapterProvider';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('DisconnectedState', () => {
  it('connects the wallet when the button is pressed', async () => {
    const connect = vi.fn();
    vi.mocked(useWallet).mockReturnValue({
      isConnected: false,
      isLoading: false,
      address: null,
      connect,
      disconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>);

    renderWithProviders(<DisconnectedState />);
    await userEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
