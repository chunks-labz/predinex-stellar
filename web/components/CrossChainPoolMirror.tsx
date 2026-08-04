'use client';

import { useState } from 'react';
import { useWallet } from './WalletAdapterProvider';
import Card from './ui/Card';
import { Link as LinkIcon, Plus, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { predinexContract } from '@/lib/contract';
import { getRuntimeConfig } from '@/app/lib/runtime-config';
import type { ChainIdValue } from '@/app/lib/soroban-transaction-service';

interface PoolMirror {
  chain: string;
  poolId: number;
  status: 'pending' | 'active' | 'settled';
  bridgeTimeout?: number;
  createdAt: number;
}

interface CrossChainPoolMirrorProps {
  poolId: number;
  isCreator: boolean;
  existingMirrors?: PoolMirror[];
}

/**
 * Target chains offered by the mirror UI.
 *
 * Restricted to the chains the on-chain `ChainId` enum supports
 * (`contracts/predinex/src/lib.rs`). Chains not in the enum (e.g. BSC,
 * Avalanche) would be rejected by the contract, so they are not offered.
 */
const SUPPORTED_CHAINS: { id: ChainIdValue; name: string; icon: string }[] = [
  { id: 'stellar', name: 'Stellar', icon: '⭐' },
  { id: 'ethereum', name: 'Ethereum', icon: '🔵' },
  { id: 'polygon', name: 'Polygon', icon: '🟣' },
  { id: 'arbitrum', name: 'Arbitrum', icon: '🌀' },
  { id: 'solana', name: 'Solana', icon: '🌴' },
];

const SOURCE_CHAIN: ChainIdValue = 'stellar';

function getChainName(id: string): string {
  return SUPPORTED_CHAINS.find(c => c.id === id)?.name ?? id;
}

export default function CrossChainPoolMirror({
  poolId,
  isCreator,
  existingMirrors = [],
}: CrossChainPoolMirrorProps) {
  const wallet = useWallet();
  const [showMirrorForm, setShowMirrorForm] = useState(false);
  const [selectedTargetChain, setSelectedTargetChain] = useState<ChainIdValue>('ethereum');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableTargetChains = SUPPORTED_CHAINS.filter(
    chain =>
      chain.id !== SOURCE_CHAIN &&
      !existingMirrors.some(m => m.chain.toLowerCase() === chain.id)
  );

  const handleCreateMirror = async () => {
    if (!wallet.address || !isCreator) return;

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const { soroban } = getRuntimeConfig();
      if (!soroban.bridgeContractId) {
        throw new Error(
          'Cross-chain mirroring is not configured. Set NEXT_PUBLIC_SOROBAN_BRIDGE_CONTRACT_ID to enable it.'
        );
      }

      const { unifiedPoolId } = await predinexContract.createPoolMirrorSoroban({
        wallet,
        poolId,
        sourceChain: SOURCE_CHAIN,
        targetChain: selectedTargetChain,
        bridgeContractId: soroban.bridgeContractId,
      });

      setSuccess(
        unifiedPoolId > 0
          ? `Mirror to ${getChainName(selectedTargetChain)} created (unified pool #${unifiedPoolId}). The bridge will settle it once the target chain confirms the registration.`
          : `Mirror to ${getChainName(selectedTargetChain)} created. The bridge will settle it once the target chain confirms the registration.`
      );
      setShowMirrorForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mirror');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelMirror = () => {
    if (!wallet.address || !isCreator) return;

    // The on-chain contract has no `cancel_pool_mirror` entry point yet.
    // Surface an explicit error instead of silently doing nothing.
    setError(
      'Cancelling a pending mirror is not yet supported by the on-chain contract. The mirror will remain active until the bridge settles it.'
    );
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Cross-Chain Mirroring</h3>
        </div>
        {isCreator && (
          <button
            onClick={() => setShowMirrorForm(!showMirrorForm)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Mirror
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-200">{success}</p>
        </div>
      )}

      {/* Existing Mirrors */}
      {existingMirrors.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Active Mirrors</p>
          <div className="space-y-2">
            {existingMirrors.map((mirror) => {
              const chain = SUPPORTED_CHAINS.find(c => c.id === mirror.chain.toLowerCase());
              return (
                <div key={mirror.chain} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/40">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{chain?.icon || '🔗'}</span>
                    <div>
                      <p className="font-medium text-sm">{chain?.name || mirror.chain}</p>
                      <p className="text-xs text-muted-foreground">Pool #{mirror.poolId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                      mirror.status === 'active'
                        ? 'bg-green-500/20 text-green-300'
                        : mirror.status === 'pending'
                        ? 'bg-yellow-500/20 text-yellow-300 flex items-center gap-1'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      {mirror.status === 'pending' && <Clock className="h-3 w-3" />}
                      {mirror.status.charAt(0).toUpperCase() + mirror.status.slice(1)}
                    </span>
                    {isCreator && mirror.status === 'pending' && (
                      <button
                        onClick={handleCancelMirror}
                        className="px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 rounded transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Mirror Form */}
      {showMirrorForm && (
        <div className="p-4 bg-muted/30 border border-border/40 rounded-lg space-y-4">
          <div>
            <label className="text-sm font-medium block mb-2">Target Chain</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availableTargetChains.length > 0 ? (
                availableTargetChains.map((chain) => (
                  <button
                    key={chain.id}
                    onClick={() => setSelectedTargetChain(chain.id)}
                    className={`p-3 rounded-lg border transition-all text-sm font-medium ${
                      selectedTargetChain === chain.id
                        ? 'bg-primary/20 border-primary text-primary'
                        : 'bg-background border-border/40 text-foreground hover:border-border'
                    }`}
                  >
                    <span className="block text-lg mb-1">{chain.icon}</span>
                    {chain.name}
                  </button>
                ))
              ) : (
                <p className="col-span-full text-sm text-muted-foreground">
                  All chains already have mirrors for this pool
                </p>
              )}
            </div>
          </div>

          {availableTargetChains.length > 0 && (
            <>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateMirror}
                  disabled={loading}
                  data-testid="mirror-create-submit"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {loading ? 'Creating...' : 'Create Mirror'}
                </button>
                <button
                  onClick={() => setShowMirrorForm(false)}
                  className="flex-1 px-4 py-2 bg-muted text-foreground rounded-lg font-medium hover:bg-muted/80 transition-all"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Empty State */}
      {existingMirrors.length === 0 && !showMirrorForm && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {isCreator
            ? 'No cross-chain mirrors yet. Create one to expand your pool to other networks.'
            : 'This pool is not mirrored on other chains.'}
        </p>
      )}
    </Card>
  );
}
