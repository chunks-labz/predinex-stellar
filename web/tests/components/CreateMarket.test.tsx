import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateMarket from '../../app/create/page';
import { useTxStatus } from '../../app/lib/hooks/useTxStatus';
import { renderWithProviders } from '../helpers/renderWithProviders';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../app/lib/runtime-config', () => ({
    getRuntimeConfig: vi.fn(() => ({
        network: 'testnet',
        contract: {
            address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
            name: 'predinex-pool',
            id: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
        },
        api: { coreApiUrl: '', explorerUrl: '', rpcUrl: '' },
    })),
}));

const mockOpenContractCall = vi.fn();
vi.mock('@stacks/connect', () => ({
    openContractCall: (...args: unknown[]) => mockOpenContractCall(...args),
    AppConfig: vi.fn(),
    UserSession: vi.fn(() => ({
        isSignInPending: () => false,
        isUserSignedIn: () => false,
        handlePendingSignIn: vi.fn(),
        loadUserData: vi.fn(),
        signUserOut: vi.fn(),
    })),
    showConnect: vi.fn(),
}));

const mockAuthenticate = vi.fn();
vi.mock('../../app/components/StacksProvider', () => ({
    useStacks: vi.fn(),
    StacksProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/Navbar', () => ({
    default: () => <nav data-testid="navbar" />,
}));

vi.mock('../../components/AuthGuard', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/hooks/useTxStatus', () => ({
    useTxStatus: vi.fn(() => [{ status: 'idle', txId: null, error: null }, vi.fn()]),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import * as StacksProvider from '../../app/components/StacksProvider';

function setupWithUser(userData: unknown = { appPrivateKey: 'key' }) {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
        userData,
        authenticate: mockAuthenticate,
        userSession: {} as any,
        setUserData: vi.fn(),
        signOut: vi.fn(),
        openWalletModal: vi.fn(),
        isLoading: false,
    });
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/question/i), 'Will BTC hit 100k?');
    await user.type(screen.getByLabelText(/description/i), 'Resolution based on Coinbase price at midnight UTC.');
    await user.type(screen.getByLabelText(/outcome a/i), 'Yes');
    await user.type(screen.getByLabelText(/outcome b/i), 'No');
    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), '1440');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CreateMarket page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders all form fields', () => {
        setupWithUser();
        renderWithProviders(<CreateMarket />);
        expect(screen.getByLabelText(/question/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/outcome a/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/outcome b/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create market/i })).toBeInTheDocument();
    });

    it('shows inline validation errors and blocks transaction on invalid submit', async () => {
        setupWithUser();
        const user = userEvent.setup();
        renderWithProviders(<CreateMarket />);

        await user.click(screen.getByRole('button', { name: /create market/i }));

        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });

        expect(mockOpenContractCall).not.toHaveBeenCalled();
    });

    it('shows a validation error when outcomes are identical', async () => {
        setupWithUser();
        const user = userEvent.setup();
        renderWithProviders(<CreateMarket />);

        await user.type(screen.getByLabelText(/question/i), 'Will BTC hit 100k?');
        await user.type(screen.getByLabelText(/description/i), 'Resolution based on Coinbase price at midnight UTC.');
        await user.type(screen.getByLabelText(/outcome a/i), 'Yes');
        await user.type(screen.getByLabelText(/outcome b/i), 'Yes');
        await user.type(screen.getByLabelText(/duration/i), '1440');

        await user.click(screen.getByRole('button', { name: /create market/i }));

        await waitFor(() => {
            expect(screen.getByText(/outcomes must be different/i)).toBeInTheDocument();
        });
        expect(mockOpenContractCall).not.toHaveBeenCalled();
    });

    it('calls openContractCall with correct args on valid submit', async () => {
        setupWithUser();
        mockOpenContractCall.mockImplementation(({ onFinish }) => {
            onFinish({ txId: 'mock-tx-id-123' });
        });

        const user = userEvent.setup();
        renderWithProviders(<CreateMarket />);

        await fillValidForm(user);
        await user.click(screen.getByRole('button', { name: /create market/i }));

        await waitFor(() => {
            expect(mockOpenContractCall).toHaveBeenCalledOnce();
        });

        const callArgs = mockOpenContractCall.mock.calls[0][0];
        expect(callArgs.functionName).toBe('create-pool');
        expect(callArgs.contractName).toBe('predinex-pool');
    });

    it('shows success feedback after transaction completes', async () => {
        setupWithUser();
        // Make useTxStatus return 'pending' once trackTx is called
        const mockTrackTx = vi.fn();
        vi.mocked(useTxStatus).mockReturnValue([{ status: 'pending', txId: 'mock-tx-id-123', error: null }, mockTrackTx]);

        mockOpenContractCall.mockImplementation(({ onFinish }) => {
            onFinish({ txId: 'mock-tx-id-123' });
        });

        const user = userEvent.setup();
        renderWithProviders(<CreateMarket />);

        await fillValidForm(user);
        await user.click(screen.getByRole('button', { name: /create market/i }));

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeInTheDocument();
        });
        expect(mockTrackTx).toHaveBeenCalledWith('mock-tx-id-123');
    });

    it('calls authenticate when wallet is not connected and form is submitted', async () => {
        setupWithUser(null); // no userData = not connected
        const user = userEvent.setup();
        renderWithProviders(<CreateMarket />);

        await user.click(screen.getByRole('button', { name: /create market/i }));

        expect(mockAuthenticate).toHaveBeenCalledOnce();
        expect(mockOpenContractCall).not.toHaveBeenCalled();
    });

    it('clears field error when user starts typing', async () => {
        setupWithUser();
        const user = userEvent.setup();
        renderWithProviders(<CreateMarket />);

        // Trigger validation errors
        await user.click(screen.getByRole('button', { name: /create market/i }));
        await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));

        // Start typing in title — its error should disappear
        await user.type(screen.getByLabelText(/question/i), 'A');
        await waitFor(() => {
            expect(screen.queryByText(/title is required/i)).not.toBeInTheDocument();
        });
    });
});
