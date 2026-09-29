'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import WalletConnectGate from '@/components/WalletConnectGate';
import { useWallet } from '@/components/WalletAdapterProvider';
import { getWalletAuthHeaders } from '@/app/lib/wallet-auth-client';

type AdminStatus = 'checking' | 'needs-signature' | 'authorized' | 'denied';

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * Gate for admin pages. Requires a connected wallet and a server-issued admin
 * session (POST /api/admin/session with a signed wallet challenge).
 *
 * This mirrors the server decision for UX only. Admin data must still be
 * fetched from routes that call `requireAdminSession`, and admin writes are
 * enforced by the contract's own `require_auth` on the admin address.
 */
function AdminSessionGate({ children }: AdminGuardProps) {
  const { address } = useWallet();
  const [status, setStatus] = useState<AdminStatus>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('checking');
    fetch('/api/admin/session', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { authorized?: boolean; address?: string } | null) => {
        if (cancelled) return;
        const sameWallet = data?.address && address && data.address.toUpperCase() === address.toUpperCase();
        setStatus(data?.authorized && sameWallet ? 'authorized' : 'needs-signature');
      })
      .catch(() => {
        if (!cancelled) setStatus('needs-signature');
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const authenticate = useCallback(async () => {
    if (!address) return;
    setError(null);
    setStatus('checking');
    try {
      const headers = await getWalletAuthHeaders('admin', address);
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
      });
      const data = (await res.json().catch(() => ({}))) as { authorized?: boolean; error?: string };
      if (res.ok && data.authorized) {
        setStatus('authorized');
      } else {
        setError(data.error ?? 'Admin verification failed.');
        setStatus(res.status === 403 ? 'denied' : 'needs-signature');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin verification failed.');
      setStatus('needs-signature');
    }
  }, [address]);

  if (status === 'authorized') return <>{children}</>;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md w-full mx-4 glass p-8 rounded-xl text-center">
        {status === 'checking' ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        ) : (
          <>
            <ShieldAlert className="w-8 h-8 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-4">
              {status === 'denied' ? 'Access denied' : 'Admin verification required'}
            </h2>
            <p className="text-muted-foreground mb-6">
              {status === 'denied'
                ? 'The connected wallet does not hold an admin role.'
                : 'Sign a message with your wallet to prove you control an admin address.'}
            </p>
            {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
            {status === 'needs-signature' && (
              <button
                onClick={authenticate}
                className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                Verify admin wallet
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminGuard({ children }: AdminGuardProps) {
  return (
    <WalletConnectGate>
      <AdminSessionGate>{children}</AdminSessionGate>
    </WalletConnectGate>
  );
}
