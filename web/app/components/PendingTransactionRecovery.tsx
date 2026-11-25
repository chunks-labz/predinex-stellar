'use client';

import { useEffect, useState } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { useToast } from '../../providers/ToastProvider';
import { clearPending, readPending, PENDING_TTL_MS } from '../lib/pending-transactions';
import { getRuntimeConfig } from '../lib/runtime-config';

export default function PendingTransactionRecovery() {
  const [hashes, setHashes] = useState<string[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    const { network, soroban } = getRuntimeConfig();
    const pending = new Map(readPending(network).map(entry => [entry.hash, entry.submittedAt]));
    if (!pending.size) return;
    setHashes(Array.from(pending.keys()));
    const server = new rpc.Server(soroban.rpcUrl);
    const inFlight = new Set<string>();
    let mounted = true;

    function finish(hash: string) {
      clearPending(network, hash);
      pending.delete(hash);
      setHashes(Array.from(pending.keys()));
      if (!pending.size) window.clearInterval(timer);
    }

    function reconcile() {
      for (const [hash, submittedAt] of pending) {
        if (Date.now() - submittedAt >= PENDING_TTL_MS) {
          finish(hash);
          continue;
        }
        if (inFlight.has(hash)) continue;
        inFlight.add(hash);
        server.getTransaction(hash).then(({ status }) => {
          if (!mounted || !pending.has(hash)) return;
          if (status === 'SUCCESS' || status === 'FAILED') {
            finish(hash);
            const ok = status === 'SUCCESS';
            showToast(`Transaction ${hash.slice(0, 8)} ${ok ? 'confirmed' : 'failed on-chain'}.`, ok ? 'success' : 'error');
          }
        }).catch(() => { /* Retry temporary RPC failures until the record expires. */ })
          .finally(() => inFlight.delete(hash));
      }
    }

    const timer = window.setInterval(reconcile, 5000);
    reconcile();
    return () => { mounted = false; window.clearInterval(timer); };
  }, [showToast]);

  if (!hashes.length) return null;
  return (
    <aside role="status" className="fixed bottom-20 right-4 z-50 rounded-lg border bg-background p-3 text-sm">
      {hashes.map(hash => <p key={hash}>Awaiting confirmation · <code title={hash}>{hash.slice(0, 12)}</code></p>)}
    </aside>
  );
}
