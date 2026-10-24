import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CrossChainPoolMirror from '../../components/CrossChainPoolMirror';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import * as runtimeConfig from '@/app/lib/runtime-config';
import { renderWithProviders } from '../helpers/renderWithProviders';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    createPoolMirrorSoroban: vi.fn(),
    cancelPoolMirrorSoroban: vi.fn(),
  },
}));

vi.mock('@/app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(),
}));

const mockCreatePoolMirror = vi.mocked(predinexContract.createPoolMirrorSoroban);
const mockCancelPoolMirror = vi.mocked(predinexContract.cancelPoolMirrorSoroban);

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'GBUSER123STELLARADDRESS',
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const disconnectedWallet = {
  ...connectedWallet,
  isConnected: false,
  address: null,
};

function setWalletState(wallet: typeof connectedWallet | typeof disconnectedWallet) {
  vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(wallet as never);
}

function setBridgeConfig(bridgeContractId: string | undefined) {
  vi.mocked(runtimeConfig.getRuntimeConfig).mockReturnValue({
    network: 'testnet',
    contract: { address: 'C0', name: '', id: 'C0' },
    api: { coreApiUrl: 'https://core.test', explorerUrl: 'https://exp.test', rpcUrl: 'https://rpc.test' },
    soroban: {
      rpcUrl: 'https://soroban.test',
      explorerUrl: 'https://exp.test',
      contractId: 'C0',
      bridgeContractId,
    },
  } as never);
}

async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /create mirror/i }));
}

describe('CrossChainPoolMirror', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWalletState(connectedWallet);
    setBridgeConfig('CBRIDGE000000000000000000000000000000000000000000001');
  });

  it('offers only chains the on-chain ChainId enum supports (no stellar target, no BSC/Avalanche)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CrossChainPoolMirror poolId={1} isCreator />);

    await openCreateForm(user);

    expect(screen.getByRole('button', { name: /ethereum/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /polygon/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /arbitrum/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /solana/i })).toBeInTheDocument();
    // Source chain (stellar) is never a mirror target.
    expect(screen.queryByRole('button', { name: /stellar/i })).not.toBeInTheDocument();
    // Chains missing from the contract enum are not offered.
    expect(screen.queryByRole('button', { name: /bsc/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /avalanche/i })).not.toBeInTheDocument();
  });

  it('calls create_pool_mirror and shows a success message, closing the form', async () => {
    const user = userEvent.setup();
    mockCreatePoolMirror.mockResolvedValue({ txHash: '0xtx', unifiedPoolId: 42 });

    renderWithProviders(<CrossChainPoolMirror poolId={7} isCreator />);
    await openCreateForm(user);

    await user.click(screen.getByTestId('mirror-create-submit'));

    await waitFor(() => {
      expect(mockCreatePoolMirror).toHaveBeenCalledWith(
        expect.objectContaining({
          poolId: 7,
          sourceChain: 'stellar',
          targetChain: 'ethereum',
          bridgeContractId: 'CBRIDGE000000000000000000000000000000000000000000001',
        })
      );
    });

    expect(await screen.findByText(/mirror to ethereum created \(unified pool #42\)/i)).toBeInTheDocument();
    // Form closes on success.
    await waitFor(() => {
      expect(screen.queryByTestId('mirror-create-submit')).not.toBeInTheDocument();
    });
  });

  it('surfaces a config error and keeps the form open when no bridge contract is configured', async () => {
    const user = userEvent.setup();
    setBridgeConfig(undefined);

    renderWithProviders(<CrossChainPoolMirror poolId={1} isCreator />);
    await openCreateForm(user);

    await user.click(screen.getByTestId('mirror-create-submit'));

    expect(await screen.findByText(/NEXT_PUBLIC_SOROBAN_BRIDGE_CONTRACT_ID/i)).toBeInTheDocument();
    expect(mockCreatePoolMirror).not.toHaveBeenCalled();
    expect(screen.getByTestId('mirror-create-submit')).toBeInTheDocument();
  });

  it('shows an error and keeps the form open when the contract call rejects', async () => {
    const user = userEvent.setup();
    mockCreatePoolMirror.mockRejectedValue(new Error('Transaction failed on-chain'));

    renderWithProviders(<CrossChainPoolMirror poolId={1} isCreator />);
    await openCreateForm(user);

    await user.click(screen.getByTestId('mirror-create-submit'));

    expect(await screen.findByText(/transaction failed on-chain/i)).toBeInTheDocument();
    expect(screen.getByTestId('mirror-create-submit')).toBeInTheDocument();
  });

  it('does nothing when the wallet is not connected', async () => {
    const user = userEvent.setup();
    setWalletState(disconnectedWallet);

    renderWithProviders(<CrossChainPoolMirror poolId={1} isCreator />);
    await openCreateForm(user);

    await user.click(screen.getByTestId('mirror-create-submit'));

    expect(mockCreatePoolMirror).not.toHaveBeenCalled();
  });

  it('lists the mirror it just created instead of reporting success with no record', async () => {
    const user = userEvent.setup();
    mockCreatePoolMirror.mockResolvedValue({ txHash: '0xtx', unifiedPoolId: 42 });

    renderWithProviders(<CrossChainPoolMirror poolId={7} isCreator />);
    await openCreateForm(user);
    await user.click(screen.getByTestId('mirror-create-submit'));

    expect(await screen.findByText(/mirror to ethereum created \(unified pool #42\)/i)).toBeInTheDocument();
    // The confirmation names the transaction, so it can be checked on-chain.
    expect(screen.getByText(/Transaction 0xtx/)).toBeInTheDocument();
    // The mirror is now visible, and the empty state no longer contradicts it.
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.queryByText(/no cross-chain mirrors yet/i)).not.toBeInTheDocument();

    // A chain that now has a mirror is no longer offered as a target.
    await openCreateForm(user);
    expect(screen.queryByRole('button', { name: /ethereum/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /polygon/i })).toBeInTheDocument();
  });

  it('calls cancel_pool_mirror and drops the mirror once the contract accepts it', async () => {
    const user = userEvent.setup();
    mockCancelPoolMirror.mockResolvedValue({ txHash: '0xcancel' });

    renderWithProviders(
      <CrossChainPoolMirror
        poolId={7}
        isCreator
        existingMirrors={[
          { chain: 'ethereum', poolId: 99, status: 'pending', createdAt: Date.now() },
        ]}
      />
    );

    await user.click(screen.getByTestId('mirror-cancel-ethereum'));

    await waitFor(() => {
      expect(mockCancelPoolMirror).toHaveBeenCalledWith(
        expect.objectContaining({ poolId: 7 })
      );
    });

    expect(await screen.findByText(/mirror to ethereum cancelled\. transaction 0xcancel/i)).toBeInTheDocument();
    // The cancelled mirror is gone from the list.
    await waitFor(() => {
      expect(screen.queryByText('Ethereum')).not.toBeInTheDocument();
    });
  });

  it('keeps the mirror listed and explains the failure when the cancel is rejected', async () => {
    const user = userEvent.setup();
    mockCancelPoolMirror.mockRejectedValue(new Error('Mirror not found'));

    renderWithProviders(
      <CrossChainPoolMirror
        poolId={7}
        isCreator
        existingMirrors={[
          { chain: 'ethereum', poolId: 99, status: 'pending', createdAt: Date.now() },
        ]}
      />
    );

    await user.click(screen.getByTestId('mirror-cancel-ethereum'));

    expect(await screen.findByText(/could not cancel the ethereum mirror: mirror not found/i)).toBeInTheDocument();
    // Nothing was cancelled on-chain, so the mirror is still shown.
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
  });
});
