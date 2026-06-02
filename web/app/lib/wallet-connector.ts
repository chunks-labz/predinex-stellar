/**
 * Wallet connector for the Stellar/Freighter frontend path.
 *
 * This module intentionally avoids Stacks SDK imports. The app's active
 * transaction flow uses `WalletAdapterProvider` + `FreighterWalletClient`.
 * This helper remains as a lightweight compatibility layer for older UI
 * surfaces that still call into `connectWallet` or `isWalletAvailable`.
 */

import { createFreighterAdapter, isFreighterInstalled } from './freighter-adapter';
import { createWalletError, WalletErrorType } from './wallet-errors';

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
  const wallet = createFreighterAdapter(() => {});

  if (!isFreighterInstalled()) {
    throw createWalletError(WalletErrorType.EXTENSION_NOT_FOUND, 'Freighter');
  }

  try {
    await wallet.connect();
    options.onFinish?.();
  } catch (error) {
    options.onCancel?.();
    throw error;
  }
}

export function isWalletAvailable(walletType: WalletType): boolean {
  if (walletType === 'walletconnect') {
    return true;
  }

  return isFreighterInstalled();
}
