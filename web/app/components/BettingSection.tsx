'use client';

import { useState } from 'react';
import { useToast } from '../../providers/ToastProvider';
import { predinexContract } from '../lib/adapters/predinex-contract';
import { Loader2, Wallet, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import type { Pool } from '@/app/lib/adapters/types';
import { useWallet } from './WalletAdapterProvider';
import { TruncatedAddress } from '../../components/TruncatedAddress';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { useTxStatus } from '../lib/hooks/useTxStatus';
import {
    classifyConnectivityIssue,
} from '../lib/network-errors';
import { invalidateOnPlaceBet } from '../lib/cache-invalidation';
import {
    MIN_BET_STX,
    connectivityErrorToast,
    showToastPayload,
    toastMessages,
} from '@/lib/toast-messages';

interface BettingSectionProps {
    pool: Pool;
    poolId: number;
    onBetSuccess?: (outcome: number, amount: number) => void;
}

export default function BettingSection({ pool, poolId, onBetSuccess }: BettingSectionProps) {
    const { isConnected, address, connect } = useWallet();
    const { isMismatch, expectedNetworkName, switchNetwork } = useNetworkMismatch();
    const { showToast } = useToast();
    const [betAmount, setBetAmount] = useState("");
    const [isBetting, setIsBetting] = useState(false);
    const [txState, trackTx] = useTxStatus();

    // Derived directly from connection state — no effect needed for this mock value
    const walletBalance: number | null = isConnected ? 100.0 : null;

    const placeBet = async (outcome: number) => {
        if (!isConnected) {
            connect();
            return;
        }

        const amount = parseFloat(betAmount);
        if (!betAmount || isNaN(amount) || amount <= 0) {
            showToastPayload(showToast, toastMessages.bet.invalidAmount);
            return;
        }

        if (amount < MIN_BET_STX) {
            showToastPayload(showToast, toastMessages.bet.minBet());
            return;
        }

        // Check wallet balance
        if (walletBalance !== null && amount > walletBalance) {
            showToastPayload(showToast, toastMessages.bet.insufficientBalance(walletBalance));
            return;
        }

        setIsBetting(true);
        const amountInMicroStx = Math.floor(parseFloat(betAmount) * 1_000_000);
        const slowNetworkTimer = window.setTimeout(() => {
            showToastPayload(showToast, toastMessages.network.slowConfirmation);
        }, 10000);

        try {
            await predinexContract.placeBet({
                poolId,
                outcome,
                amountMicroStx: amountInMicroStx,
                onFinish: (data) => {
                    window.clearTimeout(slowNetworkTimer);
                    console.log('Bet placed successfully:', data);
                    if (data?.txId) {
                        trackTx(data.txId);
                    }
                    // Invalidate all caches affected by this bet
                    if (address) {
                        invalidateOnPlaceBet({ poolId, userAddress: address });
                    }
                    showToastPayload(showToast, toastMessages.bet.success);
                    setIsBetting(false);
                    setBetAmount("");
                    if (onBetSuccess) {
                        onBetSuccess(outcome, amountInMicroStx);
                    }
                },
                onCancel: () => {
                    window.clearTimeout(slowNetworkTimer);
                    console.log('User cancelled bet transaction');
                    showToastPayload(showToast, toastMessages.bet.transactionCancelled);
                    setIsBetting(false);
                },
            });
        } catch (error) {
            window.clearTimeout(slowNetworkTimer);
            console.error("Bet transaction failed:", error);
            const issue = classifyConnectivityIssue(error);
            showToastPayload(showToast, connectivityErrorToast(issue, 'Placing your bet'));
            setIsBetting(false);
        }
    };

    if (pool.settled) {
        return (
            <div className="text-center py-6 bg-muted/50 rounded-lg">
                <p className="text-lg font-bold">This pool has been settled.</p>
                <p className="text-muted-foreground">Winner: {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}</p>
            </div>
        );
    }

    if (!isConnected) {
        return (
            <div className="text-center py-6 bg-muted/50 rounded-lg">
                <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-bold mb-2">Connect Wallet to Bet</p>
                <p className="text-muted-foreground mb-4">You need to connect your wallet to place bets on this market.</p>
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

    return (
        <div className="space-y-4">
            {/* Wallet Info */}
            {isConnected && address && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-sm text-muted-foreground">Connected Wallet</p>
                            <TruncatedAddress address={address} className="font-mono text-sm" />
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-muted-foreground">Balance</p>
                            <p className="font-bold">{walletBalance?.toFixed(2) || '0'} STX</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Balance Warning */}
            {walletBalance !== null && walletBalance < MIN_BET_STX && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-600">
                        Insufficient balance to place bets. Minimum: {MIN_BET_STX} STX
                    </p>
                </div>
            )}

            {/* Network Mismatch Warning */}
            {isConnected && isMismatch && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex flex-col gap-2">
                    <div className="flex gap-2 text-red-500">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">Wrong Network: Please switch to {expectedNetworkName} to place bets.</p>
                    </div>
                    <button 
                        onClick={() => switchNetwork()}
                        className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors self-start"
                    >
                        Switch to {expectedNetworkName}
                    </button>
                </div>
            )}

            {/* Bet Amount Input */}
            <div>
                <label className="block text-sm font-medium mb-2">Bet Amount (STX)</label>
                <input
                    type="number"
                    step="0.1"
                    min={String(MIN_BET_STX)}
                    className="w-full bg-muted/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="e.g., 10"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    disabled={isBetting || (walletBalance !== null && walletBalance < MIN_BET_STX)}
                    aria-label="Enter bet amount in STX"
                />
            </div>

            {/* Transaction Status Banner */}
            {txState.status === 'pending' && (
                <div role="status" className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Transaction pending… <span className="font-mono">{txState.txId?.slice(0, 12)}…</span></span>
                </div>
            )}
            {txState.status === 'success' && (
                <div role="status" className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 text-sm">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Bet confirmed on-chain!</span>
                </div>
            )}
            {txState.status === 'failed' && (
                <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-sm">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>{txState.error}</span>
                </div>
            )}

            {/* Bet Buttons */}
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => placeBet(0)}
                    disabled={isBetting || (walletBalance !== null && walletBalance < MIN_BET_STX)}
                    className="py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {isBetting ? <Loader2 className="w-5 h-5 animate-spin" /> : `Bet on ${pool.outcomeA}`}
                </button>
                <button
                    onClick={() => placeBet(1)}
                    disabled={isBetting || (walletBalance !== null && walletBalance < MIN_BET_STX)}
                    className="py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {isBetting ? <Loader2 className="w-5 h-5 animate-spin" /> : `Bet on ${pool.outcomeB}`}
                </button>
            </div>
        </div>
    );
}
