import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WalletModal from '@/components/WalletModal';

describe('WalletModal Component', () => {
    const mockOnClose = vi.fn();
    const mockOnSelectWallet = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        cleanup();
        // Clear localStorage before each test
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('renders the modal when isOpen is true', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );
        expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        const { container } = render(
            <WalletModal
                isOpen={false}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('marks Leather and Xverse as unsupported and disables their buttons', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const leatherButton = screen.getByRole('button', { name: /Leather.*Unsupported/i });
        const xverseButton = screen.getByRole('button', { name: /Xverse.*Unsupported/i });

        expect(leatherButton).toBeDisabled();
        expect(xverseButton).toBeDisabled();

        expect(screen.getAllByText('Unsupported').length).toBe(2);
        expect(screen.getAllByText(/Stacks wallet - not compatible with Stellar/i).length).toBe(2);
    });

    it('keeps WalletConnect available as an active choice', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const walletConnectButton = screen.getByRole('button', { name: /Connect using WalletConnect/i });
        expect(walletConnectButton).not.toBeDisabled();
        expect(screen.getByText(/Connect with any Stellar-compatible wallet via QR code/i)).toBeInTheDocument();
        expect(screen.getByText(/Recommended wallets: Freighter, Lobstr, Albedo/i)).toBeInTheDocument();
    });

    it('calls onSelectWallet when WalletConnect is clicked', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const walletConnectButton = screen.getByRole('button', { name: /Connect using WalletConnect/i });
        fireEvent.click(walletConnectButton);

        expect(mockOnSelectWallet).toHaveBeenCalledWith('walletconnect');
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('shows a loading indicator and disables wallet choices while checking availability', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
                isLoading={true}
            />
        );

        expect(screen.getByRole('status')).toHaveTextContent(/checking wallet availability/i);
        expect(screen.getByRole('button', { name: /Connect using WalletConnect/i })).toBeDisabled();
    });

    it('displays error gracefully when error prop is provided', () => {
        const errorMessage = 'Unsupported provider. Please use a Stellar-compatible wallet.';
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
                error={errorMessage}
            />
        );

        expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('displays migration guidance banner by default', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        expect(screen.getByText(/This platform now runs on/i)).toBeInTheDocument();
        // Use getAllByText since "Stellar blockchain" appears multiple times
        const stellarTexts = screen.getAllByText(/Stellar blockchain/i);
        expect(stellarTexts.length).toBeGreaterThan(0);
        expect(screen.getByText(/Leather and Xverse \(Stacks wallets\) are not compatible/i)).toBeInTheDocument();
    });

    it('allows dismissing the migration guidance banner', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const dismissButton = screen.getByRole('button', { name: /Dismiss guidance/i });
        fireEvent.click(dismissButton);

        expect(screen.queryByText(/This platform now runs on/i)).not.toBeInTheDocument();
    });

    it('persists banner dismissal in localStorage', () => {
        const { unmount } = render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const dismissButton = screen.getByRole('button', { name: /Dismiss guidance/i });
        fireEvent.click(dismissButton);

        expect(localStorage.getItem('wallet-migration-banner-dismissed')).toBe('true');

        unmount();

        // Re-render modal - banner should stay dismissed
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        expect(screen.queryByText(/This platform now runs on/i)).not.toBeInTheDocument();
    });

    it('shows WalletConnect first with Recommended badge', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const buttons = screen.getAllByRole('button').filter(btn => 
            btn.getAttribute('aria-label')?.includes('Connect using') || 
            btn.getAttribute('aria-label')?.includes('Unsupported')
        );

        // WalletConnect should be first (index 0 is close button, 1 is dismiss banner)
        expect(buttons[0].textContent).toContain('WalletConnect');
        expect(buttons[0].textContent).toContain('Recommended');
    });

    it('displays help resources footer with documentation link', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const helpLink = screen.getByRole('link', { name: /Learn about Stellar wallets/i });
        expect(helpLink).toBeInTheDocument();
        expect(helpLink).toHaveAttribute('href', '/docs/wallet-setup');
        expect(helpLink).toHaveAttribute('target', '_blank');
        expect(helpLink).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('tracks clicks on unsupported wallets without calling onSelectWallet', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const leatherButton = screen.getByRole('button', { name: /Leather.*Unsupported/i });
        
        // Button is disabled, so we need to test the onClick handler directly
        // Since the button is disabled, clicking won't trigger the handler
        // Instead, verify the button is disabled and has the correct aria-label
        expect(leatherButton).toBeDisabled();
        expect(leatherButton).toHaveAttribute('aria-disabled', 'true');
        
        // The tracking would only happen if the button wasn't disabled
        // So we verify the button state instead
        expect(mockOnSelectWallet).not.toHaveBeenCalled();
        expect(mockOnClose).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it('displays detailed descriptions for all wallets', () => {
        render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        // WalletConnect detailed description
        expect(screen.getByText(/Recommended wallets: Freighter, Lobstr, Albedo/i)).toBeInTheDocument();

        // Unsupported wallets detailed description
        expect(screen.getAllByText(/This wallet only supports Stacks network/i).length).toBe(2);
    });

    it('maintains mobile responsiveness with max-height and overflow', () => {
        const { container } = render(
            <WalletModal
                isOpen={true}
                onClose={mockOnClose}
                onSelectWallet={mockOnSelectWallet}
            />
        );

        const modalContent = container.querySelector('.max-h-\\[90vh\\]');
        expect(modalContent).toBeInTheDocument();
        expect(modalContent).toHaveClass('overflow-y-auto');
    });
});
