"use client";
import { createScopedLogger } from "@/app/lib/logger";
const log = createScopedLogger("BettingSection");

import { useMemo, useState } from 'react';
import { Loader2, Wallet, AlertCircle, Lock, Clock } from 'lucide-react';
import type { Pool } from '@/app/lib/adapters/types';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import { invalidateOnPlaceBet } from '@/app/lib/cache-invalidation';
import { toastMessages, showToastPayload } from '@/lib/toast-messages';
import { validateBetAmount } from '@/lib/validators';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import { TruncatedAddress } from '@/components/TruncatedAddress';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { useWalletAccount } from '@/lib/hooks/useWalletAccount';
import { useTransactionToast } from '@/lib/hooks/useTransactionToast';
import type { TxStage } from '@/app/lib/soroban-transaction-service';

interface BettingSectionProps {
  pool: Pool;
  poolId: number;
  onBetSuccess?: (outcome: number, amount: number) => void;
}

export default function BettingSection({
  pool,
  poolId,
  onBetSuccess,
}: BettingSectionProps) {
  const wallet = useWallet();
  const { isConnected, address, connect } = wallet;
  const { showToast } = useToast();
  const { onStageChange, showError, showSuccess } = useTransactionToast();
  const [betAmount, setBetAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [isBetting, setIsBetting] = useState(false);
  const [feePrompt, setFeePrompt] = useState<{
    feeStroops: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [stage, setStage] = useState<TxStage>("idle");

  // Issue #1603: Field-level error mapping for simulation failures
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rawError, setRawError] = useState<string | null>(null);

  /**
   * Maps known contract error codes to the relevant form field.
   * Returns the field name and a user-friendly message.
   * Unknown errors map to no field (generic toast only).
   */
  const mapContractErrorToField = (
    errorMsg: string,
  ): { field: string | null; message: string } => {
    const lower = errorMsg.toLowerCase();

    // Amount-related errors → bet-amount field
    if (lower.includes("amount") && (lower.includes("zero") || lower.includes("negative") || lower.includes("invalid"))) {
      return { field: "bet-amount", message: "Invalid bet amount. Please enter a positive value." };
    }
    if (lower.includes("min") && lower.includes("bet")) {
      return { field: "bet-amount", message: `Bet amount is below the minimum (${minBetXlm} XLM).` };
    }
    if (lower.includes("max") && lower.includes("bet")) {
      return { field: "bet-amount", message: `Bet amount exceeds the maximum (${maxBetXlm ?? "—"} XLM).` };
    }
    if (lower.includes("insufficient") && (lower.includes("balance") || lower.includes("funds"))) {
      return { field: "bet-amount", message: "Insufficient balance for this bet amount." };
    }
    if (lower.includes("overflow")) {
      return { field: "bet-amount", message: "Bet amount is too large and would overflow the pool." };
    }

    // Pool state errors → pool (no specific field, show notice)
    if (lower.includes("pool") && (lower.includes("expired") || lower.includes("closed"))) {
      return { field: null, message: "This market has expired and can no longer accept bets." };
    }
    if (lower.includes("frozen")) {
      return { field: null, message: "This market is frozen and cannot accept bets." };
    }
    if (lower.includes("disputed")) {
      return { field: null, message: "This market is under dispute and cannot accept bets." };
    }
    if (lower.includes("settled")) {
      return { field: null, message: "This market has already been settled." };
    }

    // Authorization errors → wallet connection
    if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("signature")) {
      return { field: "wallet", message: "Wallet authorization failed. Please reconnect and try again." };
    }
    if (lower.includes("not") && lower.includes("initialized")) {
      return { field: null, message: "Contract is not initialized. Please contact support." };
    }

    // Simulation/preflight errors
    if (lower.includes("simulation") || lower.includes("preflight") || lower.includes("simulate")) {
      return { field: null, message: "Transaction simulation failed. Please check your inputs and try again." };
    }

    // Network errors
    if (lower.includes("network") || lower.includes("timeout") || lower.includes("connection")) {
      return { field: null, message: "Network error. Please check your connection and try again." };
    }

    // Fallback: generic message, raw error available behind details toggle
    return { field: null, message: "Transaction failed. See details below." };
  };

  const STROOPS_PER_XLM = 10_000_000;

  // Per-pool limits (raw stroops) — optional for legacy pools.
  const minBetStroops = pool.minBet ?? 0;
  const maxBetStroops = pool.maxBet ?? 0;
  const minBetXlm = minBetStroops / STROOPS_PER_XLM;
  const hasMinBet = minBetStroops > 0;
  const hasMaxBet = maxBetStroops > 0;
  const maxBetXlm = hasMaxBet ? maxBetStroops / STROOPS_PER_XLM : null;

  const { balance } = useWalletAccount();
  const parsedWalletBalance = Number.parseFloat(balance);
  const walletBalance: number | null =
    isConnected && Number.isFinite(parsedWalletBalance) ? parsedWalletBalance : null;

  const { isMismatch, expectedNetworkName } = useNetworkMismatch();

  // Inline, client-side validation of the bet amount. Returns a human-readable
  // error string, or null when the amount is valid for this pool. Runs on every
  // change/blur so the form can show feedback and disable submission before the
  // user ever triggers a transaction.
  const amountError = useMemo<string | null>(() => {
    if (betAmount.trim() === "") {
      return "Amount is required";
    }
    const amountXlm = parseFloat(betAmount);
    // Base checks (number, > 0, global bounds) reuse the shared validator.
    const base = validateBetAmount(amountXlm);
    if (!base.valid) {
      return base.error ?? "Invalid amount";
    }
    // Pool-specific limits take precedence over the global bounds.
    if (hasMinBet && amountXlm < minBetXlm) {
      return `Minimum bet is ${minBetXlm} XLM`;
    }
    if (hasMaxBet && maxBetXlm !== null && amountXlm > maxBetXlm) {
      return `Maximum bet is ${maxBetXlm} XLM`;
    }
    if (walletBalance !== null && amountXlm > walletBalance) {
      return `Amount exceeds your balance of ${walletBalance.toFixed(2)} XLM`;
    }
    return null;
  }, [betAmount, hasMinBet, minBetXlm, hasMaxBet, maxBetXlm, walletBalance]);

  const isAmountInvalid = amountError !== null;
  const showAmountError = amountTouched && isAmountInvalid;

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
      showToastPayload(
        showToast,
        toastMessages.bet.insufficientBalance(walletBalance),
      );
      return;
    }

    setIsBetting(true);

    try {
      await predinexContract.placeBetSoroban({
        wallet,
        poolId,
        outcome,
        amountStroops,
        onStageChange: (s) => {
          setStage(s);
          onStageChange(s);
        },
        onFeeEstimated: (fee) =>
          new Promise((resolve) => {
            setFeePrompt({ feeStroops: fee, resolve });
          }),
      });

      if (address) {
        invalidateOnPlaceBet({ poolId, userAddress: address });
      }

      showSuccess("Bet placed successfully!");
      setBetAmount("");
      setStage("idle");
      setFeePrompt(null);
      // Issue #1603: Clear field-level errors on success
      setFieldErrors({});
      setRawError(null);
      onBetSuccess?.(outcome, amountStroops);
    } catch (error) {
      log.error("[BettingSection] Bet transaction failed:", error);

      // Issue #1603: Map known contract error codes to field-level messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      const mapped = mapContractErrorToField(errorMessage);

      if (mapped.field) {
        setFieldErrors((prev) => ({ ...prev, [mapped.field]: mapped.message }));
        // Also show as toast for visibility
        showToastPayload(showToast, {
          title: mapped.message,
          description: undefined,
          variant: "error",
        });
      } else {
        showError(mapped.message);
      }

      // Keep the raw error behind a details toggle
      setRawError(errorMessage);
      setStage("idle");
      setFeePrompt(null);
    } finally {
      setIsBetting(false);
    }
  };

  if (pool.settled) {
    // Issue #1602: Explain why a settled market cannot be traded
    return (
      <div className="text-center py-6 bg-muted/50 rounded-lg">
        <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-lg font-bold">Trading is Closed</p>
        <p className="text-muted-foreground mb-2">
          This market has been settled.
        </p>
        <p className="text-sm text-muted-foreground">
          Winner: {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
        </p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          Settled markets cannot accept new bets. The outcome has been
          determined on-chain.
        </p>
      </div>
    );
  }

  // Issue #1602: Explain why non-active markets cannot be traded
  if (pool.status === "expired") {
    return (
      <div className="text-center py-6 bg-yellow-500/5 rounded-lg border border-yellow-500/10">
        <Clock className="w-8 h-8 mx-auto mb-3 text-yellow-500" />
        <p className="text-lg font-bold">Trading is Closed</p>
        <p className="text-muted-foreground mb-2">
          This market has expired and is awaiting settlement.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          The expiry block has passed. Bets are locked until the market is
          settled by the oracle.
        </p>
      </div>
    );
  }

  if (pool.status === "frozen") {
    return (
      <div className="text-center py-6 bg-blue-500/5 rounded-lg border border-blue-500/10">
        <Lock className="w-8 h-8 mx-auto mb-3 text-blue-500" />
        <p className="text-lg font-bold">Trading is Paused</p>
        <p className="text-muted-foreground mb-2">
          This market has been frozen by the contract admin.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          Trading is temporarily disabled. This may occur during oracle
          disputes or emergency halts.
        </p>
      </div>
    );
  }

  if (pool.status === "disputed") {
    return (
      <div className="text-center py-6 bg-orange-500/5 rounded-lg border border-orange-500/10">
        <AlertCircle className="w-8 h-8 mx-auto mb-3 text-orange-500" />
        <p className="text-lg font-bold">Trading is Paused</p>
        <p className="text-muted-foreground mb-2">
          This market is under dispute and awaiting resolution.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          Bets cannot be placed while a dispute is active. Resolution will
          determine the final outcome.
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
  const oddsA =
    totalPool > 0 ? ((pool.totalA / totalPool) * 100).toFixed(1) : "50.0";
  const oddsB =
    totalPool > 0 ? ((pool.totalB / totalPool) * 100).toFixed(1) : "50.0";

  return (
    <div className="bg-muted/30 p-6 rounded-xl border border-border space-y-4">
      <h3 className="font-bold">Place Bet</h3>

      {/* Current odds */}
      <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
        <p className="text-sm text-muted-foreground mb-2">Current Odds</p>
        <div className="flex h-3 rounded-full overflow-hidden mb-2">
          <div
            className="bg-green-500 transition-all duration-500"
            style={{ width: `${oddsA}%` }}
          />
          <div
            className="bg-red-500 transition-all duration-500"
            style={{ width: `${oddsB}%` }}
          />
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
        feeStroops={feePrompt?.feeStroops || "0"}
        onConfirm={() => {
          feePrompt?.resolve(true);
          setFeePrompt(null);
        }}
        onCancel={() => {
          feePrompt?.resolve(false);
          setFeePrompt(null);
          setIsBetting(false);
          setStage("idle");
        }}
        isConfirming={
          stage === "signing" || stage === "submitting" || stage === "polling"
        }
      />

      {/* Wallet info */}
      {address && (
        <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-muted-foreground">Connected Wallet</p>
              <TruncatedAddress
                address={address}
                className="font-mono text-sm"
              />
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Balance</p>
              <p className="font-bold">
                {walletBalance?.toFixed(2) ?? "0"} XLM
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Insufficient balance warning */}
      {walletBalance !== null &&
        hasMinBet &&
        walletBalance < minBetXlm &&
        !isMismatch && (
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
          inputMode="decimal"
          step="0.1"
          min={hasMinBet ? String(minBetXlm) : undefined}
          max={hasMaxBet && maxBetXlm !== null ? String(maxBetXlm) : undefined}
          placeholder="e.g., 10"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          onBlur={() => setAmountTouched(true)}
          disabled={
            isBetting ||
            (walletBalance !== null &&
              hasMinBet &&
              walletBalance < minBetXlm) ||
            isMismatch
          }
          aria-label="Enter bet amount in XLM"
          aria-describedby="bet-limits"
          className="w-full px-4 py-3 rounded-lg bg-background border border-input outline-none focus:border-primary focus:ring-2 focus:ring-primary/50 text-base"
        />
        {/* #715 — Quick-select percentage buttons for mobile */}
        {walletBalance !== null && walletBalance > 0 && (
          <div
            className="flex gap-2 mt-2"
            role="group"
            aria-label="Quick bet percentage"
          >
            {[10, 25, 50, 100].map((pct) => {
              const amt = Math.floor(((walletBalance * pct) / 100) * 10) / 10;
              return (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setBetAmount(String(amt))}
                  disabled={isBetting || isMismatch}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg border border-border bg-muted/50 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                  aria-label={`Set bet to ${pct}% of balance`}
                >
                  {pct}%
                </button>
              );
            })}
          </div>
        )}
        {/* Issue #1603: Field-level error for the bet amount */}
        {fieldErrors["bet-amount"] && (
          <p className="text-xs text-red-400 mt-1 animate-pulse" role="alert">
            {fieldErrors["bet-amount"]}
          </p>
        )}
        <p id="bet-limits" className="text-xs text-muted-foreground mt-2">
          Bet limits: {hasMinBet ? `Min ${minBetXlm} XLM` : "No minimum"}
          {hasMaxBet && maxBetXlm !== null
            ? `, Max ${maxBetXlm} XLM`
            : ", No maximum"}
        </p>
      </div>

      {/* Bet buttons */}
      <div
        className="grid grid-cols-2 gap-4"
        role="group"
        aria-label="Place your bet"
      >
        <button
          onClick={() => placeBet(0)}
          disabled={
            isBetting ||
            isAmountInvalid ||
            (walletBalance !== null &&
              hasMinBet &&
              walletBalance < minBetXlm) ||
            isMismatch
          }
          aria-label={`Bet on ${pool.outcomeA}`}
          className="py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
          {isBetting ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : isMismatch ? (
            "Wrong Network"
          ) : (
            `Bet on ${pool.outcomeA}`
          )}
        </button>
        <button
          onClick={() => placeBet(1)}
          disabled={
            isBetting ||
            isAmountInvalid ||
            (walletBalance !== null &&
              hasMinBet &&
              walletBalance < minBetXlm) ||
            isMismatch
          }
          aria-label={`Bet on ${pool.outcomeB}`}
          className="py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
          {isBetting ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : isMismatch ? (
            "Wrong Network"
          ) : (
            `Bet on ${pool.outcomeB}`
          )}
        </button>
      </div>

      {/* Issue #1603: Raw error details behind a toggle */}
      {rawError && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            Show technical error details
          </summary>
          <pre className="mt-2 p-3 bg-muted/30 rounded-lg border border-border/50 overflow-auto text-xs text-red-400/70 max-w-full whitespace-pre-wrap">
            {rawError}
          </pre>
        </details>
      )}
    </div>
  );
}
