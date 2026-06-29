import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WalletModal from '@/components/WalletModal';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';

describe('WalletModal — a11y migration (#236)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('exposes role="dialog" with aria-modal and aria-labelledby', () => {
    render(
      <WalletModal isOpen onClose={() => {}} onSelectWallet={() => {}} />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading?.textContent).toMatch(/Connect Wallet/i);
  });

  it('Escape closes the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <WalletModal isOpen onClose={onClose} onSelectWallet={() => {}} />
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('traps Tab focus inside the modal', async () => {
    const user = userEvent.setup();
    render(
      <WalletModal isOpen onClose={() => {}} onSelectWallet={() => {}} />
    );

    const dialog = screen.getByRole('dialog');

    // Tab through every focusable in the dialog several times — focus must never escape.
    for (let i = 0; i < 12; i++) {
      await user.tab();
      const activeEl = document.activeElement as HTMLElement | null;
      expect(activeEl && dialog.contains(activeEl)).toBe(true);
    }
  });
});

describe('TransactionFeeModal — a11y migration (#236)', () => {
  beforeEach(() => cleanup());

  it('exposes role="dialog" with aria-modal and labelled heading', () => {
    render(
      <TransactionFeeModal
        isOpen
        actionName="Create Pool"
        feeStroops="500"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toMatch(/Confirm Transaction/i);
  });

  it('Escape calls onCancel when not confirming', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TransactionFeeModal
        isOpen
        actionName="Create Pool"
        feeStroops="500"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('Escape is ignored while a confirmation is in flight', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TransactionFeeModal
        isOpen
        actionName="Create Pool"
        feeStroops="500"
        onConfirm={() => {}}
        onCancel={onCancel}
        isConfirming
      />
    );
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});
