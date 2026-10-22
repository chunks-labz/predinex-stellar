"use client";
import { createScopedLogger } from "@/app/lib/logger";
const log = createScopedLogger("BettingSection");

import { useMemo, useState } from 'react';
import { Loader2, Wallet, AlertCircle } from 'lucide-react';
import type { Pool } from '@/app/lib/adapters/types';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import { invalidateOnPlaceBet } from '@/app/lib/cache-invalidation';
import { toastMessages, showToastPayload } from '@/lib/toast-messages';
import { validateBetAmount, clampBetAmount } from '@/lib/validators';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import { TruncatedAddress } from '@/components/TruncatedAddress';
import { NetworkMismatchWarning } from '@/components/NetworkMismatchWarning';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { useWalletAccount } from '@/lib/hooks/useWalletAccount';
import { useTransactionToast } from '@/lib/hooks/useTransactionToast';
import type { TxStage } from '@/app/lib/soroban-transaction-service';
import { useI18n } from '@/app/lib/i18n';

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
  const { onStageChange, showError, showSuccess } = useTransactionToast();
  const [betAmount, setBetAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [isBetting, setIsBetting] = useState(false);
  const [feePrompt, setFeePrompt] = useState<{
    feeStroops: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [stage, setStage] = useState<TxStage>("idle");

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
  const showAmountError = amountTouched && isAmountInvalid;
  // #1538 — the bet buttons are disabled while the amount is empty, but the
  // error message only appeared after blur, so an untouched field left the user
  // staring at two permanently disabled buttons with no explanation. Show a
  // quiet hint until they interact, then hand over to the error message.
  const showAmountHint = !amountTouched && betAmount.trim() === '';
  const describedBy = [
    'bet-limits',
    showAmountError ? 'bet-amount-error' : null,
    showAmountHint ? 'bet-amount-hint' : null,
  ]
    .filter(Boolean)
    .join(' ');

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

      showSuccess(t('betting.successMessage'));
      setBetAmount("");
      setStage("idle");
      setFeePrompt(null);
      onBetSuccess?.(outcome, amountStroops);
    } catch (error) {
      log.error("[BettingSection] Bet transaction failed:", error);
      showError(error instanceof Error ? error.message : "Unknown error");
      setStage("idle");
      setFeePrompt(null);
    } finally {
      setIsBetting(false);
    }
  };

  if (pool.settled) {
    return (
      <div className="text-center py-6 bg-muted/50 rounded-lg">
        <p className="text-lg font-bold">{t('betting.poolSettled')}</p>
        <p className="text-muted-foreground">
          {t('betting.winner')} {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
        </p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-6 bg-muted/50 rounded-lg">
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

  return (
    <div className="bg-muted/30 p-6 rounded-xl border border-border space-y-4">
      <h3 className="font-bold">{t('betting.sectionTitle')}</h3>

      {/* Current odds */}
      <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
        <p className="text-sm text-muted-foreground mb-2">{t('betting.currentOdds')}</p>
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
          {t('betting.totalPool')} {(totalPool / STROOPS_PER_XLM).toLocaleString()} XLM
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
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-muted-foreground">{t('betting.connectedWallet')}</p>
              <TruncatedAddress
                address={address}
                className="font-mono text-sm"
              />
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{t('betting.balance')}</p>
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
          aria-invalid={showAmountError}
          className="w-full px-4 py-3 rounded-lg bg-background border border-input outline-none focus:border-primary focus:ring-2 focus:ring-primary/50 text-base"
        />
        {/* #715 — Quick-select buttons for mobile */}
        {quickBetOptions.length > 0 && (
          <div
            className="flex gap-2 mt-2"
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
                  className="flex-1 py-2 text-xs font-semibold rounded-lg border border-border bg-muted/50 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                  aria-label={ariaLabel}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
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
      </div>

      {/* Bet buttons */}
      <div
        className="grid grid-cols-2 gap-4"
        role="group"
        aria-label={t('betting.sectionTitle')}
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
          aria-label={t('betting.betOnAriaLabel').replace('{outcome}', pool.outcomeA)}
          className="py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
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
          onClick={() => placeBet(1)}
          disabled={
            isBetting ||
            isAmountInvalid ||
            (walletBalance !== null &&
              hasMinBet &&
              walletBalance < minBetXlm) ||
            isMismatch
          }
          aria-label={t('betting.betOnAriaLabel').replace('{outcome}', pool.outcomeB)}
          className="py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
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
    </div>
  );
}
