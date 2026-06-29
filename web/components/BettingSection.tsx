'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('BettingSection');

import { useState } from 'react';
import { Loader2, Wallet, AlertCircle } from 'lucide-react';
import type { Pool } from '@/app/lib/adapters/types';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import { invalidateOnPlaceBet } from '@/app/lib/cache-invalidation';
import { toastMessages, showToastPayload } from '@/lib/toast-messages';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import { TruncatedAddress } from '@/components/TruncatedAddress';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import type { TxStage } from '@/app/lib/soroban-transaction-service';

interface BettingSectionProps {
    pool: Pool;
    poolId: number;
    onBetSuccess?: (outcome: number, amount: number) => void;
}

export default function BettingSection({ pool, poolId, onBetSuccess }: BettingSectionProps) {
    const wallet = useWallet();
    const { isConnected, address, connect } = wallet;
    const { showToast } = useToast();
    const [betAmount, setBetAmount] = useState('');
    const [isBetting, setIsBetting] = useState(false);
    const [feePrompt, setFeePrompt] = useState<{ feeStroops: string; resolve: (v: boolean) => void } | null>(null);
    const [stage, setStage] = useState<TxStage>('idle');

    const STROOPS_PER_XLM = 10_000_000;

    // Per-pool limits (raw stroops) — optional for legacy pools.
    const minBetStroops = pool.minBet ?? 0;
    const maxBetStroops = pool.maxBet ?? 0;
    const minBetXlm = minBetStroops / STROOPS_PER_XLM;
    const hasMinBet = minBetStroops > 0;
    const hasMaxBet = maxBetStroops > 0;
    const maxBetXlm = hasMaxBet ? maxBetStroops / STROOPS_PER_XLM : null;

    // Derived wallet balance (placeholder — replace with real balance hook if available).
    const walletBalance: number | null = isConnected ? 100.0 : null;

    const { isMismatch, expectedNetworkName } = useNetworkMismatch();

    const placeBet = async (outcome: number) => {
        if (!isConnected) {
            connect();
            return;
        }

        // Numeric validation on the amount input.
        const amountXlm = parseFloat(betAmount);
        if (!betAmount || isNaN(amountXlm) || amountXlm <= 0) {
            showToastPayload(showToast, toastMessages.bet.invalidAmount);
            return;
        }

        const amountStroops = Math.floor(amountXlm * STROOPS_PER_XLM);

        if (hasMinBet && amountStroops < minBetStroops) {
            showToastPayload(showToast, toastMessages.bet.minBet(minBetXlm));
            return;
        }

        if (hasMaxBet && maxBetStroops > 0 && amountStroops > maxBetStroops) {
            showToastPayload(showToast, toastMessages.bet.maxBet(maxBetXlm ?? 0));
            return;
        }

        if (walletBalance !== null && amountXlm > walletBalance) {
            showToastPayload(showToast, toastMessages.bet.insufficientBalance(walletBalance));
            return;
        }

        setIsBetting(true);

        try {
            await predinexContract.placeBetSoroban({
                wallet,
                poolId,
                outcome,
                amountStroops,
                onStageChange: (s) => setStage(s),
                onFeeEstimated: (fee) =>
                    new Promise((resolve) => {
                        setFeePrompt({ feeStroops: fee, resolve });
                    }),
            });

            if (address) {
                invalidateOnPlaceBet({ poolId, userAddress: address });
            }

            showToast('Bet placed successfully!', 'success');
            setBetAmount('');
            setStage('idle');
            setFeePrompt(null);
            onBetSuccess?.(outcome, amountStroops);
        } catch (error) {
            log.error('[BettingSection] Bet transaction failed:', error);
            showToast(
                `Failed to place bet: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'error'
            );
            setStage('idle');
            setFeePrompt(null);
        } finally {
            setIsBetting(false);
        }
    };

    if (pool.settled) {
        return (
            <div className="text-center py-6 bg-muted/50 rounded-lg">
                <p className="text-lg font-bold">This pool has been settled.</p>
                <p className="text-muted-foreground">
                    Winner: {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
                </p>
            </div>
        );
    }

    if (!isConnected) {
        return (
            <div className="text-center py-6 bg-muted/50 rounded-lg">
                <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-bold mb-2">Connect Wallet to Bet</p>
                <p className="text-muted-foreground mb-4">
                    You need to connect your wallet to place bets on this market.
                </p>
                <button
                    onClick={connect}
                    className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-6 py-3 rounded-full border border-primary/20 transition font-medium mx-auto hover:scale-105"
                >
                    <Wallet className="w-5 h-5" />
                    Connect Wallet
                </button>
            </div>
        );
    }

    const totalPool = pool.totalA + pool.totalB;
    const oddsA = totalPool > 0 ? ((pool.totalA / totalPool) * 100).toFixed(1) : '50.0';
    const oddsB = totalPool > 0 ? ((pool.totalB / totalPool) * 100).toFixed(1) : '50.0';

    return (
        <div className="bg-muted/30 p-6 rounded-xl border border-border space-y-4">
            <h3 className="font-bold">Place Bet</h3>

            {/* Current odds */}
            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                <p className="text-sm text-muted-foreground mb-2">Current Odds</p>
                <div className="flex h-3 rounded-full overflow-hidden mb-2">
                    <div className="bg-green-500 transition-all duration-500" style={{ width: `${oddsA}%` }} />
                    <div className="bg-red-500 transition-all duration-500" style={{ width: `${oddsB}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                    <div className="text-green-400">
                        <span className="font-medium">{pool.outcomeA}</span>
                        <span className="ml-1 text-muted-foreground">{oddsA}%</span>
                    </div>
                    <div className="text-red-400">
                        <span className="mr-1 text-muted-foreground">{oddsB}%</span>
                        <span className="font-medium">{pool.outcomeB}</span>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                    Total pool: {(totalPool / STROOPS_PER_XLM).toLocaleString()} XLM
                </p>
            </div>

            {/* Transaction fee confirmation modal */}
            <TransactionFeeModal
                isOpen={!!feePrompt}
                actionName="Place Bet"
                feeStroops={feePrompt?.feeStroops || '0'}
                onConfirm={() => {
                    feePrompt?.resolve(true);
                    setFeePrompt(null);
                }}
                onCancel={() => {
                    feePrompt?.resolve(false);
                    setFeePrompt(null);
                    setIsBetting(false);
                    setStage('idle');
                }}
                isConfirming={stage === 'signing' || stage === 'submitting' || stage === 'polling'}
            />

            {/* Wallet info */}
            {address && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-sm text-muted-foreground">Connected Wallet</p>
                            <TruncatedAddress address={address} className="font-mono text-sm" />
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-muted-foreground">Balance</p>
                            <p className="font-bold">{walletBalance?.toFixed(2) ?? '0'} XLM</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Insufficient balance warning */}
            {walletBalance !== null && hasMinBet && walletBalance < minBetXlm && !isMismatch && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-600">
                        Insufficient balance. Minimum bet: {minBetXlm} XLM
                    </p>
                </div>
            )}

            {/* Network mismatch warning */}
            {isMismatch && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-600">
                        Please switch to {expectedNetworkName} to place bets.
                    </p>
                </div>
            )}

            {/* Amount input */}
            <div>
                <label htmlFor="bet-amount" className="block text-sm font-medium mb-2">
                    Bet Amount (XLM)
                </label>
                <input
                    id="bet-amount"
                    type="number"
                    step="0.1"
                    min={hasMinBet ? String(minBetXlm) : undefined}
                    max={hasMaxBet && maxBetXlm !== null ? String(maxBetXlm) : undefined}
                    placeholder="e.g., 10"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    disabled={isBetting || (walletBalance !== null && hasMinBet && walletBalance < minBetXlm) || isMismatch}
                    aria-label="Enter bet amount in XLM"
                    aria-describedby="bet-limits"
                    className="w-full px-4 py-3 rounded-lg bg-background border border-input outline-none focus:border-primary focus:ring-2 focus:ring-primary/50"
                />
                <p id="bet-limits" className="text-xs text-muted-foreground mt-2">
                    Bet limits:{' '}
                    {hasMinBet ? `Min ${minBetXlm} XLM` : 'No minimum'}
                    {hasMaxBet && maxBetXlm !== null ? `, Max ${maxBetXlm} XLM` : ', No maximum'}
                </p>
            </div>

            {/* Bet buttons */}
            <div className="grid grid-cols-2 gap-4" role="group" aria-label="Place your bet">
                <button
                    onClick={() => placeBet(0)}
                    disabled={isBetting || (walletBalance !== null && hasMinBet && walletBalance < minBetXlm) || isMismatch}
                    aria-label={`Bet on ${pool.outcomeA}`}
                    className="py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {isBetting ? (
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    ) : isMismatch ? (
                        'Wrong Network'
                    ) : (
                        `Bet on ${pool.outcomeA}`
                    )}
                </button>
                <button
                    onClick={() => placeBet(1)}
                    disabled={isBetting || (walletBalance !== null && hasMinBet && walletBalance < minBetXlm) || isMismatch}
                    aria-label={`Bet on ${pool.outcomeB}`}
                    className="py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {isBetting ? (
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    ) : isMismatch ? (
                        'Wrong Network'
                    ) : (
                        `Bet on ${pool.outcomeB}`
                    )}
                </button>
            </div>
        </div>
    );
}
