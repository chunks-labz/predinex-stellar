import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatePoolForm } from '@/components/pools/CreatePoolForm';
import * as Contract from '@/lib/contract';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import { renderWithProviders } from '../helpers/renderWithProviders';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/RouteErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/contract', () => ({
  createPool: vi.fn(),
  predinexContract: {},
  predinexReadApi: {
    getPoolCount: vi.fn(),
    getPool: vi.fn(),
  },
}));

const mockConnect = vi.fn();

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'GBUSER123STELLARADDRESS',
  connect: mockConnect,
  disconnect: vi.fn(),
};

function setWalletState(overrides: Partial<typeof connectedWallet> = {}) {
  vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
    ...connectedWallet,
    ...overrides,
  } as never);
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<{
    name: string;
    description: string;
    asset: string;
    depositAmount: string;
    expirySeconds: string;
  }> = {}
) {
  await user.type(screen.getByLabelText(/pool name/i), overrides.name ?? 'BTC above $100k by 2026');
  await user.type(
    screen.getByLabelText(/description/i),
    overrides.description ?? 'Pool that resolves based on Coinbase midnight UTC price.'
  );
  if (overrides.asset) {
    await user.selectOptions(screen.getByLabelText(/asset type/i), overrides.asset);
  }
  await user.type(
    screen.getByLabelText(/deposit amount/i),
    overrides.depositAmount ?? '25'
  );
  await user.type(
    screen.getByLabelText(/expiry/i),
    overrides.expirySeconds ?? '86400'
  );
}

describe('CreatePoolForm (#677)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setWalletState();
  });

  it('renders all five required fields with their labels', () => {
    renderWithProviders(<CreatePoolForm />);

    expect(screen.getByLabelText(/pool name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/asset type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/deposit amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expiry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create pool/i })).toBeInTheDocument();
  });

  it('blocks submission and surfaces validation errors when fields are empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await user.click(screen.getByRole('button', { name: /create pool/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
    expect(Contract.createPool).not.toHaveBeenCalled();
  });

  it('rejects names shorter than the minimum length', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await user.type(screen.getByLabelText(/pool name/i), 'hi');
    await user.click(screen.getByLabelText(/pool name/i));
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/title must be at least/i)).toBeInTheDocument();
    });
  });

  it('rejects unsupported asset types on submit', async () => {
    // The select only renders the supported assets, so the validator cannot be
    // triggered through user input alone. Force an invalid value via direct
    // component state by changing the option to none (browser falls through to
    // the first entry) and then rely on submit-time validation.
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    // Sanity check: the select exposes the supported assets.
    const select = screen.getByLabelText(/asset type/i) as HTMLSelectElement;
    const optionValues = Array.from(select.querySelectorAll('option')).map(
      (opt) => opt.value
    );
    expect(optionValues).toEqual(['XLM', 'USDC', 'BTC', 'ETH']);

    await fillForm(user);
    // Swap to a non-supported value via the underlying DOM property. The select
    // visually reverts to the first option but the React state retains the
    // invalid value until the user picks another.
    Object.defineProperty(select, 'value', { configurable: true, value: 'DOGE' });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur', { bubbles: true }));

    await user.click(screen.getByRole('button', { name: /create pool/i }));

    await waitFor(() => {
      expect(screen.getByText(/unsupported asset/i)).toBeInTheDocument();
    });
  });

  it('rejects deposits below the minimum', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    const depositInput = screen.getByLabelText(/deposit amount/i);
    await user.type(depositInput, '0.01');
    await user.click(depositInput);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/deposit amount must be at least/i)).toBeInTheDocument();
    });
  });

  it('rejects expiries outside the allowed range', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    const expiry = screen.getByLabelText(/expiry/i);
    await user.type(expiry, '10');
    await user.click(expiry);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/duration must be at least/i)).toBeInTheDocument();
    });
  });

  it('invokes createPool with the composed parameters on submit', async () => {
    vi.mocked(Contract.createPool).mockResolvedValue({
      txHash: 'mock-pool-tx',
      composedDescription:
        'Pool that resolves based on Coinbase midnight UTC price.\n\n---\nPool metadata: asset=XLM; depositAmount=25; expirySeconds=86400',
      outcomes: { a: 'Yes', b: 'No' },
    });

    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create pool/i }));

    await waitFor(() => {
      expect(Contract.createPool).toHaveBeenCalledTimes(1);
    });

    const [params, options] = vi.mocked(Contract.createPool).mock.calls[0];
    expect(params).toMatchObject({
      name: 'BTC above $100k by 2026',
      description: 'Pool that resolves based on Coinbase midnight UTC price.',
      asset: 'XLM',
      depositAmount: 25,
      expirySeconds: 86400,
    });
    expect(options).toMatchObject({
      wallet: expect.objectContaining({ address: 'GBUSER123STELLARADDRESS' }),
      onStageChange: expect.any(Function),
      onFeeEstimated: expect.any(Function),
    });
  });

  it('shows the success banner containing the txHash after submission', async () => {
    vi.mocked(Contract.createPool).mockResolvedValue({
      txHash: 'mock-confirmed-pool-tx',
      composedDescription: 'test description\n\n---\nPool metadata: asset=XLM; depositAmount=25; expirySeconds=86400',
      outcomes: { a: 'Yes', b: 'No' },
    });

    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create pool/i }));

    const banner = await screen.findByTestId('pool-success-banner');
    expect(banner).toHaveTextContent(/pool created/i);
    expect(banner).toHaveTextContent(/mock-confirmed-pool-tx/i);
  });

  it('triggers wallet connect when submitted with a disconnected wallet', async () => {
    setWalletState({ isConnected: false, address: null });

    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create pool/i }));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled();
    });
    expect(Contract.createPool).not.toHaveBeenCalled();
  });

  it('shows an error toast when the contract call rejects the transaction', async () => {
    vi.mocked(Contract.createPool).mockRejectedValue(new Error('User rejected signing'));

    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create pool/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to create pool/i)).toBeInTheDocument();
    });
  });

  it('shows a fee modal and confirms the fee before submission completes', async () => {
    vi.mocked(Contract.createPool).mockImplementation(async (_params, options) => {
      const approved = await options.onFeeEstimated?.('500');
      if (!approved) throw new Error('Fee rejected');
      return {
        txHash: 'fee-modal-tx',
        composedDescription: 'whatever\n\n---\nPool metadata: asset=XLM; depositAmount=25; expirySeconds=86400',
        outcomes: { a: 'Yes', b: 'No' },
      };
    });

    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create pool/i }));

    expect(await screen.findByText(/confirm transaction/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('pool-success-banner')).toBeInTheDocument();
    });
  });

  it('clears the form via the clear button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/pool name/i)).toHaveValue('');
    expect(screen.getByLabelText(/description/i)).toHaveValue('');
    expect(screen.getByLabelText(/asset type/i)).toHaveValue('XLM');
    // type="number" inputs in jsdom return null when value is the empty
    // string. Accept either empty or null to keep the assertion stable.
    expect([
      null,
      '',
    ]).toContain((screen.getByLabelText(/deposit amount/i) as HTMLInputElement).value);
    expect([
      null,
      '',
    ]).toContain((screen.getByLabelText(/expiry/i) as HTMLInputElement).value);
  });

  it('invokes the onSuccess callback after a successful submission', async () => {
    vi.mocked(Contract.createPool).mockResolvedValue({
      txHash: 'maybe-navigate-tx',
      composedDescription: 'd\n\n---\nPool metadata: asset=XLM; depositAmount=25; expirySeconds=86400',
      outcomes: { a: 'Yes', b: 'No' },
    });

    const onSuccess = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CreatePoolForm onSuccess={onSuccess} />);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create pool/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        txHash: 'maybe-navigate-tx',
        poolId: null,
      });
    });
  });
});
