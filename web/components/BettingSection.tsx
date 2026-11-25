"use client";
import { createScopedLogger } from "@/app/lib/logger";
const log = createScopedLogger("BettingSection");

import { useMemo, useRef, useState } from 'react';
import { Loader2, Wallet, AlertCircle, Lock, Clock, Info } from 'lucide-react';
import type { Pool } from '@/app/lib/adapters/types';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import { invalidateOnPlaceBet } from '@/app/lib/cache-invalidation';
import { toastMessages, showToastPayload } from '@/lib/toast-messages';
import {
  validateBetAmount,
  clampBetAmount,
  validateSlippage,
  DEFAULT_SLIPPAGE_PERCENT,
  MIN_SLIPPAGE_PERCENT,
  MAX_SLIPPAGE_PERCENT,
} from '@/lib/validators';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import { TruncatedAddress } from '@/components/TruncatedAddress';
import { NetworkMismatchWarning } from '@/components/NetworkMismatchWarning';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { useWalletAccount } from '@/lib/hooks/useWalletAccount';
import { useTransactionToast } from '@/lib/hooks/useTransactionToast';
import type { TxStage } from '@/app/lib/soroban-transaction-service';
import { useI18n } from '@/app/lib/i18n';
import { BetConfirmationDialog } from '@/components/BetConfirmationDialog';
import { formatPrice } from '@/app/lib/formatting';
import Tooltip from '@/components/ui/Tooltip';
import { getErrorMessage } from '@/app/lib/error-handler';
import { WalletError, WalletErrorType } from '@/app/lib/wallet-errors';

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
  const { t } = useI18n();
  const wallet = useWallet();
  const { isConnected, address, connect } = wallet;
  const { showToast } = useToast();
  const { onStageChange, showError, showSuccess, dismiss } = useTransactionToast();
  const [betAmount, setBetAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [slippageTouched, setSlippageTouched] = useState(false);
  const [isBetting, setIsBetting] = useState(false);
  const betSubmissionInFlightRef = useRef(false);
  const [feePrompt, setFeePrompt] = useState<{
    feeStroops: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [stage, setStage] = useState<TxStage>("idle");
  const [pendingOutcome, setPendingOutcome] = useState<number | null>(null);
  // #1589 — the failure toast disappears on its own; keep the last failure next
  // to the bet buttons so the user can read it and retry the same outcome.
  const [betError, setBetError] = useState<{
    outcome: number;
    message: string;
    needsReconnect?: boolean;
  } | null>(null);

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

  // #1534 — the quick-select buttons used to fill in a raw percentage of the
  // wallet balance, which could land below the pool minimum or above the pool
  // maximum and leave the form permanently invalid (the buttons stayed
  // disabled with no obvious reason). Every quick amount is clamped into the
  // allowed range instead, and a "Max" option bets the largest amount the
  // wallet and the pool allow.
  const quickBetOptions = useMemo(() => {
    if (walletBalance === null || walletBalance <= 0) return [];

    const limits = {
      minBet: hasMinBet ? minBetXlm : undefined,
      maxBet: hasMaxBet ? maxBetXlm ?? undefined : undefined,
      balance: walletBalance,
    };

    const options = [10, 25, 50, 100].map((pct) => ({
      key: `pct-${pct}`,
      label: `${pct}%`,
      amount: clampBetAmount((walletBalance * pct) / 100, limits),
    }));

    options.push({
      key: 'max',
      label: t('betting.quickBetMaxLabel'),
      amount: clampBetAmount(walletBalance, limits),
    });

    return options;
  }, [walletBalance, hasMinBet, minBetXlm, hasMaxBet, maxBetXlm, t]);

  // Inline, client-side validation of the bet amount. Returns a human-readable
  // error string, or null when the amount is valid for this pool. Runs on every
  // change/blur so the form can show feedback and disable submission before the
  // user ever triggers a transaction.
  const amountError = useMemo<string | null>(() => {
    if (betAmount.trim() === "") {
      return t('betting.amountRequired');
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
  }, [betAmount, hasMinBet, minBetXlm, hasMaxBet, maxBetXlm, walletBalance, t]);

  const isAmountInvalid = amountError !== null;

  // #1682 — Does the entered amount exceed the wallet balance? Shown as a
  // dedicated inline message immediately (before blur) so the user knows the
  // trade is unaffordable before a wallet signature is requested.
  const insufficientBalance = useMemo(() => {
    if (walletBalance === null) return false;
    const amt = parseFloat(betAmount);
    return !isNaN(amt) && amt > 0 && amt > walletBalance;
  }, [betAmount, walletBalance]);

  // Show the generic amount error only for non-balance issues; balance errors
  // get their own dedicated message below.
  const showAmountError = amountTouched && isAmountInvalid && !insufficientBalance;
  // #1538 — the bet buttons are disabled while the amount is empty, but the
  // error message only appeared after blur, so an untouched field left the user
  // staring at two permanently disabled buttons with no explanation. Show a
  // quiet hint until they interact, then hand over to the error message.
  const showAmountHint = !amountTouched && betAmount.trim() === '';
  const describedBy = [
    'bet-limits',
    showAmountError ? 'bet-amount-error' : null,
    showAmountHint ? 'bet-amount-hint' : null,
    insufficientBalance ? 'insufficient-balance-warning' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const slippageValidation = useMemo(() => validateSlippage(slippage), [slippage]);
  const isSlippageInvalid = !slippageValidation.valid;
  const showSlippageError = slippageTouched && isSlippageInvalid;
  const slippageDescribedBy = [
    'slippage-range-hint',
    showSlippageError ? 'slippage-error' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const slippageErrorMessage = useMemo(() => {
    if (slippageValidation.valid) return null;
    const min = String(MIN_SLIPPAGE_PERCENT);
    const max = String(MAX_SLIPPAGE_PERCENT);
    switch (slippageValidation.code) {
      case 'required':
        return t('betting.slippageRequired');
      case 'invalid':
        return t('betting.slippageInvalid');
      case 'nonPositive':
        return t('betting.slippageNonPositive');
      case 'belowMin':
        return t('betting.slippageBelowMin').replace('{min}', min);
      case 'aboveMax':
        return t('betting.slippageAboveMax').replace('{max}', max);
      default:
        return t('betting.slippageError').replace('{min}', min).replace('{max}', max);
    }
  }, [slippageValidation, t]);

  const requestBet = (outcome: number) => {
    if (!isConnected) {
      connect();
      return;
    }

    if (isAmountInvalid) {
      setAmountTouched(true);
      return;
    }
    if (isSlippageInvalid) {
      setSlippageTouched(true);
      return;
    }
    setPendingOutcome(outcome);
  };

  const placeBet = async (outcome: number) => {
    // State updates do not disable the button until React renders again. Lock
    // synchronously so rapid confirm clicks cannot submit the same bet twice.
    if (betSubmissionInFlightRef.current) return;
    if (!isConnected) {
      connect();
      return;
    }
    if (isSlippageInvalid) {
      setSlippageTouched(true);
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

    betSubmissionInFlightRef.current = true;
    setIsBetting(true);
    setBetError(null);

    try {
      const finalSlippageValidation = validateSlippage(slippage);
      if (!finalSlippageValidation.valid) {
        setSlippageTouched(true);
        return;
      }

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

      showSuccess(t('betting.successMessage'));
      setBetAmount("");
      setStage("idle");
      setFeePrompt(null);
      // Issue #1603: Clear field-level errors on success
      setFieldErrors({});
      setRawError(null);
      // #1683 — Clear the retry prompt on confirmed success.
      setBetError(null);
      onBetSuccess?.(outcome, amountStroops);
    } catch (error) {
      log.error("[BettingSection] Bet transaction failed:", error);

      const errorMessage = getErrorMessage(error);
      const isDisconnected =
        error instanceof WalletError && error.type === WalletErrorType.WALLET_DISCONNECTED ||
        (typeof error === "object" &&
          error !== null &&
          "type" in error &&
          error.type === WalletErrorType.WALLET_DISCONNECTED);
      const message = isDisconnected ? t('betting.walletDisconnected') : errorMessage;
      dismiss();

      if (isDisconnected) {
        showToast(message, "error");
        setBetError({ outcome, message, needsReconnect: true });
      } else {
        const mapped = mapContractErrorToField(message);
        const field = mapped.field;
        if (field) {
          setFieldErrors((prev) => ({ ...prev, [field]: mapped.message }));
          showToastPayload(showToast, { message: mapped.message, type: "error" });
        } else {
          showError(mapped.message);
        }
        setBetError({ outcome, message });
      }

      setRawError(errorMessage);
      // #1683 — Preserve the bet amount so the user can retry without
      // re-entering it. Populate betError so the "Try again" UI appears
      // next to the bet buttons, giving the user a one-click retry path.
      setBetError({ outcome, message: mapped.message });
      setPendingOutcome(null);
      // #1683 — Reset the transaction stage and clear any pending fee prompt
      // so stale status messages do not persist and the fee modal does not
      // show as "confirming" on the next attempt.
      setStage("idle");
      setFeePrompt(null);
    } finally {
      betSubmissionInFlightRef.current = false;
      setIsBetting(false);
      setStage("idle");
      onStageChange("idle");
    }
  };

  const betErrorAlert = betError && !isBetting ? (
    <div
      role="alert"
      className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-red-400">
          Your bet on {betError.outcome === 0 ? pool.outcomeA : pool.outcomeB} did not go through: {betError.message}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 pl-7">
        <button
          type="button"
          onClick={() => {
            if (betError.needsReconnect) {
              connect();
              return;
            }
            requestBet(betError.outcome);
          }}
          disabled={isAmountInvalid || isSlippageInvalid || isMismatch}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          {betError.needsReconnect ? t('betting.reconnectAndTryAgain') : 'Try again'}
        </button>
        <button
          type="button"
          onClick={() => setBetError(null)}
          className="px-3 py-1.5 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  if (pool.settled) {
    // Issue #1602: Explain why a settled market cannot be traded
    return (
      <div className="text-center py-6 bg-muted/50 rounded-lg">
        <Lock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-lg font-bold">{t('betting.poolSettled')}</p>
        <p className="text-muted-foreground">
          {t('betting.winner')} {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
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
        {betErrorAlert}
        <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg font-bold mb-2">{t('betting.connectTitle')}</p>
        <p className="text-muted-foreground mb-4">
          {t('betting.connectBody')}
        </p>
        <button
          onClick={connect}
          className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-6 py-3 rounded-full border border-primary/20 transition font-medium mx-auto hover:scale-105"
        >
          <Wallet className="w-5 h-5" />
          {t('betting.connectButton')}
        </button>
      </div>
    );
  }

  const totalPool = pool.totalA + pool.totalB;
  const oddsA =
    totalPool > 0 ? ((pool.totalA / totalPool) * 100).toFixed(1) : "50.0";
  const oddsB =
    totalPool > 0 ? ((pool.totalB / totalPool) * 100).toFixed(1) : "50.0";
  const pendingOdds = pendingOutcome === 0 ? oddsA : oddsB;
  const pendingAmount = parseFloat(betAmount);
  const pendingSelectedOutcome =
    pendingOutcome === 0 ? pool.outcomeA : pool.outcomeB;
  const selectedPoolTotal =
    pendingOutcome === 0 ? pool.totalA : pendingOutcome === 1 ? pool.totalB : 0;
  const potentialWinnings =
    Number.isFinite(pendingAmount) && selectedPoolTotal > 0
      ? ((pendingAmount * STROOPS_PER_XLM * (totalPool + pendingAmount * STROOPS_PER_XLM)) /
          (selectedPoolTotal + pendingAmount * STROOPS_PER_XLM) /
          STROOPS_PER_XLM)
      : Number.isFinite(pendingAmount)
        ? pendingAmount
        : 0;

  return (
    <div className="bg-muted/30 p-4 sm:p-6 rounded-xl border border-border space-y-4">
      {pendingOutcome !== null && (
        <BetConfirmationDialog
          isOpen
          onClose={() => setPendingOutcome(null)}
          onConfirm={() => void placeBet(pendingOutcome)}
          betAmount={pendingAmount.toFixed(2)}
          selectedOutcome={pendingSelectedOutcome}
          potentialWinnings={potentialWinnings.toFixed(2)}
          currentOdds={parseFloat(pendingOdds)}
          isProcessing={isBetting}
        />
      )}
      <h3 className="font-bold">{t('betting.sectionTitle')}</h3>

      {/* Current odds */}
      <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
        <p className="text-sm text-muted-foreground mb-2">{t('betting.currentOdds')}</p>
        {totalPool === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-4 text-muted-foreground"
            role="status"
            aria-label="No bets placed yet — odds chart unavailable"
          >
            <div className="w-full h-3 rounded-full bg-muted/50 mb-2" aria-hidden="true" />
            <p className="text-xs">No bets placed yet. Be the first!</p>
          </div>
        ) : (
          <>
            <div
              className="flex h-3 rounded-full overflow-hidden mb-2"
              role="img"
              aria-label={`Odds: ${pool.outcomeA} ${oddsA}%, ${pool.outcomeB} ${oddsB}%`}
            >
              <div
                className="bg-green-500 transition-all duration-500"
                style={{ width: `${oddsA}%` }}
              />
              <div
                className="bg-red-500 transition-all duration-500"
                style={{ width: `${oddsB}%` }}
              />
            </div>
            <div className="flex justify-between gap-3 text-sm">
              <div className="text-green-400 min-w-0 break-words">
                <span className="font-medium">{pool.outcomeA}</span>
                <span className="ml-1 text-muted-foreground">{oddsA}%</span>
              </div>
              <div className="text-red-400 min-w-0 break-words text-right">
                <span className="mr-1 text-muted-foreground">{oddsB}%</span>
                <span className="font-medium">{pool.outcomeB}</span>
              </div>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground mt-1 text-center">
          {t('betting.totalPool')} {formatPrice(totalPool / STROOPS_PER_XLM)}
        </p>
        <p className="text-xs text-muted-foreground mt-1 text-center">
          {t('betting.sharesPayoutHint')}
        </p>
      </div>

      {/* Transaction fee confirmation modal */}
      <TransactionFeeModal
        isOpen={!!feePrompt}
        actionName={t('betting.actionName')}
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
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{t('betting.connectedWallet')}</p>
              <TruncatedAddress
                address={address}
                className="font-mono text-sm"
              />
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{t('betting.balance')}</p>
              <p className="font-bold">
                {formatPrice(walletBalance ?? 0)}
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
              {t('betting.insufficientBalance').replace('{min}', String(minBetXlm))}
            </p>
          </div>
        )}

      {/* Network mismatch warning — the same component the navbar banner uses,
          so the message and the switch action have one definition. The copy is
          passed in so it stays localised. */}
      <NetworkMismatchWarning
        variant="inline"
        message={t('betting.networkMismatch').replace('{network}', expectedNetworkName)}
      />

      {/* Amount input */}
      <div>
        <label htmlFor="bet-amount" className="block text-sm font-medium mb-2">
          {t('betting.amountLabel')}
        </label>
        <div className="relative">
        <input
          id="bet-amount"
          type="number"
          inputMode="decimal"
          step="0.1"
          min={hasMinBet ? String(minBetXlm) : undefined}
          max={hasMaxBet && maxBetXlm !== null ? String(maxBetXlm) : undefined}
          placeholder={t('betting.amountPlaceholder')}
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
          aria-label={t('betting.amountAriaLabel')}
          aria-describedby={describedBy}
          aria-required="true"
          aria-invalid={showAmountError}
          className="w-full pl-4 pr-14 py-3 rounded-lg bg-background border border-input outline-none focus:border-primary focus:ring-2 focus:ring-primary/50 text-base"
          onWheel={(e) => e.currentTarget.blur()}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">XLM</span>
        </div>
        {/* #715 — Quick-select buttons for mobile */}
        {quickBetOptions.length > 0 && (
          <div
            className="flex flex-wrap gap-2 mt-2"
            role="group"
            aria-label={t('betting.quickBetAriaLabel')}
          >
            {quickBetOptions.map((option) => {
              const unavailable = option.amount === null;
              const ariaLabel = unavailable
                ? t('betting.quickBetUnavailableAriaLabel').replace('{label}', option.label)
                : t('betting.quickBetAmountAriaLabel')
                    .replace('{amount}', String(option.amount))
                    .replace('{label}', option.label);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    if (option.amount === null) return;
                    setBetAmount(String(option.amount));
                    // Show the validation feedback right away: a quick amount
                    // that the pool rejects should not leave the user with a
                    // silently disabled button.
                    setAmountTouched(true);
                  }}
                  disabled={isBetting || isMismatch || unavailable}
                  title={ariaLabel}
                  className="flex-1 min-w-[3.5rem] min-h-[44px] py-2 text-xs font-semibold rounded-lg border border-border bg-muted/50 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={ariaLabel}
                >
                  {option.label}
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
          {t('betting.betLimits')}{' '}
          {hasMinBet
            ? t('betting.minLabel').replace('{min}', String(minBetXlm))
            : t('betting.noMinimum')}
          {hasMaxBet && maxBetXlm !== null
            ? `, ${t('betting.maxLabel').replace('{max}', String(maxBetXlm))}`
            : `, ${t('betting.noMaximum')}`}
        </p>
        {showAmountHint && (
          <p id="bet-amount-hint" className="text-sm text-muted-foreground mt-1">
            {t('betting.amountHint')}
          </p>
        )}
        {showAmountError && amountError && (
          <p id="bet-amount-error" role="alert" className="text-sm text-red-500 mt-1">
            {amountError}
          </p>
        )}
        {/* #1682 — Insufficient balance inline message shown immediately
            during form validation, before the user blurs the field. This
            prevents a wallet signature from being requested for an unaffordable
            trade. */}
        {insufficientBalance && walletBalance !== null && (
          <div
            id="insufficient-balance-warning"
            role="alert"
            data-testid="insufficient-balance-warning"
            className="flex items-start gap-2 mt-1.5 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-red-500">
              {t('betting.insufficientBalanceAmount')
                .replace('{balance}', walletBalance.toFixed(2))
                .replace('{amount}', parseFloat(betAmount).toFixed(2))}
            </p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="slippage" className="block text-sm font-medium mb-2">
          {t('betting.slippageLabel')}
        </label>
        <div className="relative">
          <input
            id="slippage"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={MIN_SLIPPAGE_PERCENT}
            max={MAX_SLIPPAGE_PERCENT}
            placeholder={String(DEFAULT_SLIPPAGE_PERCENT)}
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            onBlur={() => setSlippageTouched(true)}
            disabled={isBetting || isMismatch}
            aria-label={t('betting.slippageAriaLabel')}
            aria-describedby={slippageDescribedBy}
            aria-invalid={showSlippageError}
            className="w-full pl-4 pr-14 py-3 rounded-lg bg-background border border-input outline-none focus:border-primary focus:ring-2 focus:ring-primary/50 text-base"
            onWheel={(e) => e.currentTarget.blur()}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">%</span>
        </div>
        <p id="slippage-range-hint" className="text-xs text-muted-foreground mt-2">
          {t('betting.slippageHint')
            .replace('{min}', String(MIN_SLIPPAGE_PERCENT))
            .replace('{max}', String(MAX_SLIPPAGE_PERCENT))
            .replace('{default}', String(DEFAULT_SLIPPAGE_PERCENT))}
        </p>
        {showSlippageError && slippageErrorMessage && (
          <p id="slippage-error" role="alert" className="text-sm text-red-500 mt-1">
            {slippageErrorMessage}
          </p>
        )}
      </div>

      {/* Transaction status — announced to screen readers — issue 1632 */}
      <div
        id="bet-tx-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {stage === 'signing' && 'Waiting for wallet signature…'}
        {stage === 'submitting' && 'Submitting transaction to the network…'}
        {stage === 'polling' && 'Confirming transaction on-chain…'}
      </div>

      {/* Bet buttons */}
      <div
        className="grid grid-cols-2 gap-3 sm:gap-4"
        role="group"
        aria-label={t('betting.sectionTitle')}
      >
        <button
          type="button"
          onClick={() => requestBet(0)}
          aria-busy={isBetting}
          disabled={
            isBetting ||
            isAmountInvalid ||
            isSlippageInvalid ||
            (walletBalance !== null &&
              hasMinBet &&
              walletBalance < minBetXlm) ||
            isMismatch
          }
          aria-label={t('betting.betOnAriaLabel').replace('{outcome}', pool.outcomeA)}
          aria-pressed={pendingOutcome === 0}
          className={`min-h-[44px] py-4 px-3 ${pendingOutcome === 0 ? "ring-4 ring-green-300 " : ""}bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 text-center break-words focus:outline-none focus-visible:ring-4 focus-visible:ring-green-300`}
        >
          {isBetting ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : isMismatch ? (
            t('betting.wrongNetwork')
          ) : (
            t('betting.betOnButton').replace('{outcome}', pool.outcomeA)
          )}
        </button>
        <button
          type="button"
          onClick={() => requestBet(1)}
          aria-busy={isBetting}
          disabled={
            isBetting ||
            isAmountInvalid ||
            isSlippageInvalid ||
            (walletBalance !== null &&
              hasMinBet &&
              walletBalance < minBetXlm) ||
            isMismatch
          }
          aria-label={t('betting.betOnAriaLabel').replace('{outcome}', pool.outcomeB)}
          aria-pressed={pendingOutcome === 1}
          className={`min-h-[44px] py-4 px-3 ${pendingOutcome === 1 ? "ring-4 ring-red-300 " : ""}bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 text-center break-words focus:outline-none focus-visible:ring-4 focus-visible:ring-red-300`}
        >
          {isBetting ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : isMismatch ? (
            t('betting.wrongNetwork')
          ) : (
            t('betting.betOnButton').replace('{outcome}', pool.outcomeB)
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
      {betErrorAlert}

      {/* First-time-user explainer. Kept after the bet controls in the DOM so
          it does not change the primary keyboard flow, but it is focusable. */}
      <div className="flex items-center justify-center pt-1">
        <Tooltip content={t('betting.sharesPayoutInfo')}>
          <button
            type="button"
            aria-label={t('betting.sharesPayoutInfoLabel')}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 py-1 transition-colors"
          >
            <Info className="w-3.5 h-3.5" aria-hidden="true" />
            {t('betting.sharesPayoutInfoLabel')}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
