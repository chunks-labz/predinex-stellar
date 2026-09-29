/**
 * Client-side counterpart of `wallet-auth.ts`: asks the connected wallet to
 * sign a timestamped challenge and returns the headers the server verifies.
 */

const WALLET_ADDRESS_HEADER = 'x-predinex-wallet-address';
const WALLET_TIMESTAMP_HEADER = 'x-predinex-wallet-timestamp';
const WALLET_SIGNATURE_HEADER = 'x-predinex-wallet-signature';

interface MessageSigner {
  signMessage(
    message: string,
    opts?: { address?: string }
  ): Promise<{ signedMessage: string | null; signerAddress?: string } | string>;
}

function getMessageSigner(): MessageSigner | null {
  if (typeof window === 'undefined') return null;
  const freighter = (window as unknown as { freighter?: Partial<MessageSigner> }).freighter;
  return freighter?.signMessage ? (freighter as MessageSigner) : null;
}

export async function getWalletAuthHeaders(scope: string, address: string): Promise<Record<string, string>> {
  const signer = getMessageSigner();
  if (!signer) throw new Error('Connected wallet does not support message signing.');

  const timestamp = Date.now();
  const challenge = `predinex:${scope}:${address}:${timestamp}`;
  const result = await signer.signMessage(challenge, { address });
  const signature = typeof result === 'string' ? result : result.signedMessage;
  if (!signature) throw new Error('Wallet declined to sign the authentication challenge.');

  return {
    [WALLET_ADDRESS_HEADER]: address,
    [WALLET_TIMESTAMP_HEADER]: String(timestamp),
    [WALLET_SIGNATURE_HEADER]: signature,
  };
}
