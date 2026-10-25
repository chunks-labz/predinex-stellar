/**
 * Wallet connector for the Stellar/Freighter frontend path.
 *
 * This module intentionally avoids Stacks SDK imports. The app's active
 * transaction flow uses `WalletAdapterProvider` + `FreighterWalletClient`.
 * This helper remains as a lightweight compatibility layer for older UI
 * surfaces that still call into `connectWallet` or `isWalletAvailable`.
 */

import { FinishedAuthData, showConnect, UserSession } from '@stacks/connect';
import { handleWalletError, WalletError } from './wallet-errors';
import { createScopedLogger } from './logger';

const log = createScopedLogger('wallet-connector');

/**
 * Keep the legacy union so older components and tests continue to compile,
 * but the implementation now targets Freighter/Stellar only.
 */
export type WalletType = 'leather' | 'xverse' | 'walletconnect';

export interface WalletConnectionOptions {
  walletType: WalletType;
  userSession?: unknown;
  onFinish?: (authData?: unknown) => void;
  onCancel?: (error?: unknown) => void;
}

export async function connectWallet(options: WalletConnectionOptions): Promise<void> {
    const { walletType, userSession, onFinish, onCancel } = options;

    try {
        switch (walletType) {
            case 'leather':
            case 'xverse':
                await connectExtensionWallet(walletType, userSession, onFinish, onCancel);
                break;
            case 'walletconnect':
                await connectWalletConnect(userSession, onFinish, onCancel);
                break;
            default:
                throw new Error(`Unsupported wallet type: ${walletType}`);
        }
    } catch (error) {
        log.error(`Error connecting to ${walletType}`, error);
        const walletError = handleWalletError(error, walletType);
        throw walletError;
    }
}

/**
 * Internal helper to handle connections for extension-based wallets (Leather and Xverse).
 * Uses the Stacks Connect library to trigger the browser extension popup.
 * 
 * @param walletType - The type of extension wallet ('leather' or 'xverse')
 * @param userSession - The active session to be updated
 * @param onFinish - Success callback
 * @param onCancel - Cancellation callback
 */
async function connectExtensionWallet(
    walletType: 'leather' | 'xverse',
    userSession: UserSession,
    onFinish?: (authData: FinishedAuthData) => void,
    onCancel?: () => void
): Promise<void> {
    await showConnect({
        appDetails: {
            name: WALLET_CONFIG.name,
            icon: WALLET_CONFIG.icon,
        },
        redirectTo: WALLET_CONFIG.redirectTo,
        userSession,
        onFinish: async (authData) => {
            log.debug(`${walletType} authentication finished`);
            if (onFinish) {
                onFinish(authData);
            }
        },
        onCancel: () => {
            log.debug(`User cancelled ${walletType} connection`);
            if (onCancel) {
                onCancel();
            }
        },
    });
}

/**
 * Internal helper to handle connections via the WalletConnect protocol.
 * Suitable for connecting to mobile wallets by displaying a QR code.
 * 
 * @param userSession - The active session to be updated
 * @param onFinish - Success callback
 * @param onCancel - Cancellation callback
 */
async function connectWalletConnect(
    userSession: UserSession,
    onFinish?: (authData: FinishedAuthData) => void,
    onCancel?: () => void
): Promise<void> {
    await showConnect({
        appDetails: {
            name: WALLET_CONFIG.name,
            icon: WALLET_CONFIG.icon,
        },
        redirectTo: WALLET_CONFIG.redirectTo,
        userSession,
        onFinish: async (authData) => {
            log.debug('WalletConnect authentication finished');
            if (onFinish) {
                onFinish(authData);
            }
        },
        onCancel: () => {
            log.debug('User cancelled WalletConnect connection');
            if (onCancel) {
                onCancel();
            }
        },
    });
}

/**
 * Verifies if a specific wallet extension is installed and available in the user's browser.
 * 
 * @param walletType - The wallet provider to check for
 * @returns True if the wallet is detected, false otherwise
 */
export function isWalletAvailable(walletType: WalletType): boolean {
  if (walletType === 'walletconnect') {
    return true;
  }

    switch (walletType) {
        case 'leather':
            return !!(window as Window & { LeatherProvider?: unknown; stacksProvider?: unknown }).LeatherProvider
                || !!(window as Window & { LeatherProvider?: unknown; stacksProvider?: unknown }).stacksProvider;
        case 'xverse':
            return !!(window as Window & { XverseProvider?: unknown; xverse?: unknown }).XverseProvider
                || !!(window as Window & { XverseProvider?: unknown; xverse?: unknown }).xverse;
        case 'walletconnect':
            return true; // WalletConnect is always available via QR
        default:
            return false;
    }
}
