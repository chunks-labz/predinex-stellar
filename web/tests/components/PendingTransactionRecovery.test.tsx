import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PendingTransactionRecovery from '../../app/components/PendingTransactionRecovery';
import { clearPending, PENDING_TTL_MS, readPending, trackPending } from '../../app/lib/pending-transactions';

const { getTransaction, showToast } = vi.hoisted(() => ({
  getTransaction: vi.fn(), showToast: vi.fn(),
}));
vi.mock('@stellar/stellar-sdk', () => ({ rpc: { Server: class { getTransaction = getTransaction; } } }));
vi.mock('../../providers/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({ network: 'testnet', soroban: { rpcUrl: 'https://rpc.example' } }),
}));

const hash = 'ab'.repeat(32);
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it.each(['SUCCESS', 'FAILED'])('recovers a submitted hash and reconciles %s', async status => {
  vi.useFakeTimers();
  trackPending('testnet', hash);
  getTransaction.mockResolvedValueOnce({ status: 'NOT_FOUND' })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status });
  render(<PendingTransactionRecovery />);
  expect(screen.getByRole('status').textContent).toContain(hash.slice(0, 12));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(readPending('testnet')).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByRole('status')).toBeNull();
  expect(readPending('testnet')).toEqual([]);
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining(hash.slice(0, 8)),
    status === 'SUCCESS' ? 'success' : 'error');
});

it('expires unresolved entries from their first submission and isolates networks', () => {
  vi.useFakeTimers();
  trackPending('testnet', hash);
  vi.advanceTimersByTime(PENDING_TTL_MS - 1);
  trackPending('testnet', hash);
  trackPending('mainnet', hash);
  vi.advanceTimersByTime(1);
  expect(readPending('testnet')).toEqual([]);
  expect(readPending('mainnet')).toHaveLength(1);
  clearPending('mainnet', hash);
  expect(readPending('mainnet')).toEqual([]);
});
