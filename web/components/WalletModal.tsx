'use client';

/**
 * WalletModal - Unified wallet connection modal
 * Supports multiple wallet options: Leather, Xverse, and WalletConnect
 * Enhanced with explicit unsupported wallet guidance for Stellar migration
 */

import { X, Wallet, Smartphone, CheckCircle2, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { isWalletAvailable, WalletType } from '../lib/wallet-connector';
import { useState, useEffect, useId, useRef } from 'react';
import { useFocusTrap } from '../lib/hooks/useFocusTrap';
import { useEscapeDismiss } from '../lib/hooks/useEscapeDismiss';
import { createScopedLogger } from '../lib/logger';

const log = createScopedLogger('WalletModal');

interface WalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectWallet: (walletType: 'leather' | 'xverse' | 'walletconnect') => void;
    error?: string;
    isLoading?: boolean;
}

export default function WalletModal({ isOpen, onClose, onSelectWallet, error, isLoading = false }: WalletModalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    useFocusTrap({ active: isOpen, containerRef });
    useEscapeDismiss({ active: isOpen, onDismiss: onClose });

    // Track if user has dismissed the migration guidance banner
    const [isBannerDismissed, setIsBannerDismissed] = useState(false);

    // Load banner dismissal state from localStorage on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const dismissed = localStorage.getItem('wallet-migration-banner-dismissed');
            setIsBannerDismissed(dismissed === 'true');
        }
    }, []);

    // Handle banner dismissal
    const handleDismissBanner = () => {
        setIsBannerDismissed(true);
        if (typeof window !== 'undefined') {
            localStorage.setItem('wallet-migration-banner-dismissed', 'true');
        }
    };

    // Track clicks on unsupported wallets for analytics
    const handleUnsupportedWalletClick = (walletId: string) => {
        // Analytics tracking - can be integrated with your analytics service
    if (typeof window !== 'undefined') {
            const win = window as Window & { gtag?: (cmd: string, event: string, params: Record<string, string>) => void };
            if (win.gtag) {
                win.gtag('event', 'unsupported_wallet_click', {
                    wallet_type: walletId,
                    event_category: 'wallet_connection',
                });
            }
        }
    log.debug(`User attempted to click unsupported wallet: ${walletId}`);
    };

    // Derived directly from isOpen — no state or effect needed; isWalletAvailable is
    // SSR-safe and cheap to call on each render.
    const walletAvailability: Record<WalletType, boolean> = isOpen
        ? {
              leather: isWalletAvailable('leather'),
              xverse: isWalletAvailable('xverse'),
              walletconnect: isWalletAvailable('walletconnect'),
          }
        : { leather: false, xverse: false, walletconnect: true };

    if (!isOpen) return null;

    const wallets = [
        {
            id: 'walletconnect' as const,
            name: 'WalletConnect',
            description: 'Connect with any Stellar-compatible wallet via QR code',
            detailedDescription: 'Recommended wallets: Freighter, Lobstr, Albedo',
            icon: Smartphone,
            isSupported: true,
            badge: 'Recommended',
        },
        {
            id: 'leather' as const,
            name: 'Leather',
            description: 'Stacks wallet - not compatible with Stellar blockchain',
            detailedDescription: 'This wallet only supports Stacks network',
            icon: Wallet,
            isSupported: false,
            badge: 'Unsupported',
        },
        {
            id: 'xverse' as const,
            name: 'Xverse',
            description: 'Stacks wallet - not compatible with Stellar blockchain',
            detailedDescription: 'This wallet only supports Stacks network',
            icon: Wallet,
            isSupported: false,
            badge: 'Unsupported',
        },
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={onClose}
        >
            <div
                ref={containerRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                className="glass border border-border rounded-2xl p-6 max-w-md w-full mx-4 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto outline-none"
            >
                <div className="flex justify-between items-center mb-6">
                    <h2 id={titleId} className="text-2xl font-bold">Connect Wallet</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Migration Guidance Banner */}
                {!isBannerDismissed && (
                    <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-foreground leading-relaxed">
                                    This platform now runs on <strong>Stellar blockchain</strong>. Leather and Xverse (Stacks wallets) are not compatible with Stellar. 
                                    Please use <strong>WalletConnect</strong> to connect a Stellar-compatible wallet like Freighter, Lobstr, or Albedo.
                                </p>
                            </div>
                            <button
                                onClick={handleDismissBanner}
                                className="p-1 hover:bg-blue-500/20 rounded transition-colors shrink-0"
                                aria-label="Dismiss guidance"
                            >
                                <X className="w-4 h-4 text-blue-500" />
                            </button>
                        </div>
                    </div>
                )}

                {isLoading && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="mb-6 rounded-xl border border-border bg-muted/10 p-4 text-sm text-foreground animate-in fade-in"
                    >
                        Checking wallet availability…
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-500 animate-in fade-in slide-in-from-top-2">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                )}

                <div className="space-y-3">
                    {wallets.map((wallet) => {
                        const Icon = wallet.icon;
                        const isDisabled = isLoading || !wallet.isSupported || (!walletAvailability[wallet.id] && wallet.id !== 'walletconnect');
                        
                        return (
                            <button
                                key={wallet.id}
                                onClick={() => {
                                    if (!wallet.isSupported) {
                                        handleUnsupportedWalletClick(wallet.id);
                                        return;
                                    }
                                    onSelectWallet(wallet.id);
                                    onClose();
                                }}
                                disabled={isDisabled}
                                aria-label={!wallet.isSupported
                                    ? `${wallet.name} - ${wallet.badge}`
                                    : walletAvailability[wallet.id]
                                        ? `Connect using ${wallet.name} (Available)`
                                        : wallet.id === 'walletconnect'
                                            ? `Connect using WalletConnect (via QR code)`
                                            : `Connect using ${wallet.name} (Not installed)`
                                }
                                aria-disabled={isDisabled}
                                className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all relative ${
                                    wallet.isSupported
                                        ? 'border-primary/50 hover:border-primary hover:bg-primary/5 hover:shadow-lg hover:shadow-primary/10'
                                        : 'border-border opacity-60 cursor-not-allowed'
                                } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                                    wallet.isSupported ? 'bg-primary/10' : 'bg-muted/50'
                                }`}>
                                    <Icon className={`w-6 h-6 ${wallet.isSupported ? 'text-primary' : 'text-muted-foreground'}`} />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                    <div className="font-semibold flex items-center gap-2 flex-wrap">
                                        <span>{wallet.name}</span>
                                        {wallet.badge && (
                                            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${
                                                wallet.isSupported
                                                    ? 'bg-green-500/10 text-green-500'
                                                    : 'bg-red-500/10 text-red-500'
                                            }`}>
                                                {wallet.badge}
                                            </span>
                                        )}
                                        {wallet.isSupported && walletAvailability[wallet.id] && wallet.id !== 'walletconnect' && (
                                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                                        )}
                                    </div>
                                    <div className="text-sm text-muted-foreground mt-1">{wallet.description}</div>
                                    {wallet.detailedDescription && (
                                        <div className="text-xs text-muted-foreground/80 mt-1">{wallet.detailedDescription}</div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Help Resources Footer */}
                <div className="mt-6 pt-4 border-t border-border">
                    <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                        <a
                            href="/docs/wallet-setup"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-primary transition-colors"
                        >
                            <span>Learn about Stellar wallets</span>
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

