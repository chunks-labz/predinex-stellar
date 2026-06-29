'use client';
/**
 * Pool creation form (Issue #677).
 *
 * Renders an accessible single-page form for creating a pool with client-side
 * validation. Submission flows through `createPool` (web/lib/contract.ts),
 * which encodes the extended form fields into the underlying `create_pool`
 * Soroban call.
 *
 * The component contract:
 *   - Validates inputs on change, blur and submit.
 *   - Surfaces a transaction fee modal before signing.
 *   - Displays transaction pending / confirmed / failed states.
 *   - Calls `onSuccess({ txHash, poolId })` upon a confirmed submission so the
 *     parent page can perform navigation (typically `router.push('/pools/:id')`).
 *   - Shows a non-blocking error toast for rejected / failed transactions.
 */

import { FormEvent, useId, useState, useCallback } from 'react';
import { ArrowLeft, Coins, FileText, Hash, Loader2, Wallet } from 'lucide-react';
import { useWallet } from '@/components/WalletAdapterProvider';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import { useToast } from '@/providers/ToastProvider';
import {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MIN_POOL_DURATION_SECS,
  MAX_POOL_DURATION_SECS,
  MIN_DEPOSIT_AMOUNT,
  MAX_DEPOSIT_AMOUNT,
  SUPPORTED_POOL_ASSETS,
  validatePoolForm,
  getCharLimit,
  getHelpText,
} from '@/lib/validators';
import { createPool } from '@/lib/contract';
import type { TxStage } from '@/app/lib/soroban-transaction-service';

type PoolFormErrors = Partial<
  Record<'name' | 'description' | 'asset' | 'depositAmount' | 'expirySeconds', string>
>;

const EXPIRY_FIELD = 'expirySeconds';
const DEPOSIT_FIELD = 'depositAmount';

function humaniseSeconds(rawDuration: string): string {
  const seconds = parseInt(rawDuration, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${seconds} sec`;
  const minutes = seconds / 60;
  if (minutes < 60) return `≈ ${minutes.toFixed(1).replace(/\.0$/, '')} min`;
  const hours = minutes / 60;
  if (hours < 24) return `≈ ${hours.toFixed(1).replace(/\.0$/, '')} hr`;
  const days = hours / 24;
  return `≈ ${days.toFixed(1).replace(/\.0$/, '')} day${days >= 2 ? 's' : ''}`;
}

export interface CreatePoolFormState {
  name: string;
  description: string;
  asset: string;
  depositAmount: string;
  expirySeconds: string;
}

export const EMPTY_POOL_FORM: CreatePoolFormState = {
  name: '',
  description: '',
  asset: 'XLM',
  depositAmount: '',
  expirySeconds: '',
};

export interface CreatePoolFormProps {
  /**
   * Optional initial form values. Useful for tests and for restoring the
   * last draft from session storage in future iterations.
   */
  initialValues?: Partial<CreatePoolFormState>;
  /**
   * Invoked after the contract call confirms. `poolId` may be `null` when
   * the pool index cannot be derived yet (e.g. the read API hasn't picked
   * up the new pool) — callers should fall back to redirecting to the
   * markets page when `poolId` is null.
   */
  onSuccess?: (info: { txHash: string; poolId: number | null }) => void;
  /** Optional callback when the user cancels the fee prompt. */
  onCancel?: () => void;
}

interface FieldTouched {
  name: boolean;
  description: boolean;
  asset: boolean;
  depositAmount: boolean;
  expirySeconds: boolean;
}

const EMPTY_TOUCHED: FieldTouched = {
  name: false,
  description: false,
  asset: false,
  depositAmount: false,
  expirySeconds: false,
};

function getStageLabel(stage: TxStage): string {
  switch (stage) {
    case 'simulating':
      return 'Simulating transaction…';
    case 'signing':
      return 'Waiting for signature…';
    case 'submitting':
      return 'Submitting to network…';
    case 'polling':
      return 'Confirming transaction…';
    default:
      return 'Submitting…';
  }
}

export function CreatePoolForm({
  initialValues,
  onSuccess,
  onCancel,
}: CreatePoolFormProps) {
  const wallet = useWallet();
  const { showToast } = useToast();
  const formId = useId();

  const [form, setForm] = useState<CreatePoolFormState>({
    ...EMPTY_POOL_FORM,
    ...initialValues,
  });
  const [errors, setErrors] = useState<PoolFormErrors>({});
  const [touched, setTouched] = useState<FieldTouched>(EMPTY_TOUCHED);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<TxStage>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [feePrompt, setFeePrompt] = useState<{
    feeStroops: string;
    resolve: (v: boolean) => void;
  } | null>(null);

  const setField = useCallback(
    (field: keyof CreatePoolFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const validateAll = useCallback((): PoolFormErrors => {
    const expirySeconds = parseInt(form.expirySeconds, 10);
    const depositAmount = parseFloat(form.depositAmount);
    const result = validatePoolForm({
      name: form.name,
      description: form.description,
      asset: form.asset,
      depositAmount: Number.isNaN(depositAmount) ? NaN : depositAmount,
      expirySeconds: Number.isNaN(expirySeconds) ? 0 : expirySeconds,
    });
    return result.errors;
  }, [form]);

  const handleFieldBlur = useCallback(
    (field: keyof FieldTouched) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const nextErrors = validateAll();
      setErrors(nextErrors);
    },
    [validateAll]
  );

  const resetForm = useCallback(() => {
    setForm(EMPTY_POOL_FORM);
    setErrors({});
    setTouched(EMPTY_TOUCHED);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!wallet.isConnected) {
        await wallet.connect();
        return;
      }
      const nextErrors = validateAll();
      setTouched({
        name: true,
        description: true,
        asset: true,
        depositAmount: true,
        expirySeconds: true,
      });
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        showToast('Please fix the highlighted fields before submitting.', 'error');
        return;
      }

      const depositAmount = parseFloat(form.depositAmount);
      const expirySeconds = parseInt(form.expirySeconds, 10);

      setIsSubmitting(true);
      setStage('idle');
      setTxHash(null);
      try {
        const result = await createPool(
          {
            name: form.name,
            description: form.description,
            asset: form.asset,
            depositAmount,
            expirySeconds,
          },
          {
            wallet,
            onStageChange: (s) => setStage(s),
            onFeeEstimated: (fee) =>
              new Promise<boolean>((resolve) => {
                setFeePrompt({ feeStroops: fee, resolve });
              }),
          }
        );

        setTxHash(result.txHash);
        showToast('Pool created successfully!', 'success');
        resetForm();
        onSuccess?.({ txHash: result.txHash, poolId: null });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        showToast(`Failed to create pool: ${message}`, 'error');
      } finally {
        setIsSubmitting(false);
        setStage('idle');
        setFeePrompt(null);
      }
    },
    [
      wallet,
      form,
      validateAll,
      showToast,
      resetForm,
      onSuccess,
    ]
  );

  // Re-evaluate errors on every render so the field-level copy stays in sync
  // with current form values (used to apply aria-invalid hints).
  const liveErrors = errors.name || errors.description || errors.asset ||
    errors.depositAmount || errors.expirySeconds
      ? errors
      : validateAll();

  const showError = (field: keyof PoolFormErrors) =>
    touched[field] && liveErrors[field];

  return (
    <>
      <TransactionFeeModal
        isOpen={!!feePrompt}
        actionName="Create Pool"
        feeStroops={feePrompt?.feeStroops || '0'}
        onConfirm={() => {
          feePrompt?.resolve(true);
          setFeePrompt(null);
        }}
        onCancel={() => {
          feePrompt?.resolve(false);
          setFeePrompt(null);
          setIsSubmitting(false);
          setStage('idle');
          onCancel?.();
        }}
        isConfirming={
          stage === 'signing' || stage === 'submitting' || stage === 'polling'
        }
      />

      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        aria-labelledby={`${formId}-title`}
        className="space-y-6"
      >
        <h2 id={`${formId}-title`} className="sr-only">
          Create pool
        </h2>

        {/* Pool name */}
        <div>
          <label
            htmlFor={`${formId}-name`}
            className="flex items-center gap-2 text-sm font-medium mb-1"
          >
            <Hash className="w-4 h-4" aria-hidden="true" />
            Pool name
          </label>
          <input
            id={`${formId}-name`}
            name="name"
            type="text"
            autoComplete="off"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            onBlur={() => handleFieldBlur('name')}
            placeholder="e.g. BTC above $100k by 2026"
            aria-invalid={!!showError('name')}
            aria-describedby={
              showError('name') ? `${formId}-name-error` : `${formId}-name-help`
            }
            maxLength={MAX_TITLE_LENGTH}
            className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              showError('name') ? 'border-red-500' : 'border-input'
            }`}
          />
          <div className="flex justify-between items-center mt-1">
            {showError('name') ? (
              <p
                id={`${formId}-name-error`}
                role="alert"
                className="text-sm text-red-500"
              >
                {liveErrors.name}
              </p>
            ) : (
              <p
                id={`${formId}-name-help`}
                className="text-xs text-muted-foreground"
              >
                {getHelpText('title')}
              </p>
            )}
            <span className="text-xs text-muted-foreground">
              {form.name.length}/{getCharLimit('title') ?? MAX_TITLE_LENGTH}
            </span>
          </div>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor={`${formId}-description`}
            className="flex items-center gap-2 text-sm font-medium mb-1"
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            Description
          </label>
          <textarea
            id={`${formId}-description`}
            name="description"
            rows={4}
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            onBlur={() => handleFieldBlur('description')}
            placeholder="Describe the pool, including any resolution criteria."
            aria-invalid={!!showError('description')}
            aria-describedby={
              showError('description')
                ? `${formId}-description-error`
                : `${formId}-description-help`
            }
            maxLength={MAX_DESCRIPTION_LENGTH}
            className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none ${
              showError('description') ? 'border-red-500' : 'border-input'
            }`}
          />
          <div className="flex justify-between items-center mt-1">
            {showError('description') ? (
              <p
                id={`${formId}-description-error`}
                role="alert"
                className="text-sm text-red-500"
              >
                {liveErrors.description}
              </p>
            ) : (
              <p
                id={`${formId}-description-help`}
                className="text-xs text-muted-foreground"
              >
                {getHelpText('description')}
              </p>
            )}
            <span className="text-xs text-muted-foreground">
              {form.description.length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </div>
        </div>

        {/* Asset & Deposit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor={`${formId}-asset`}
              className="flex items-center gap-2 text-sm font-medium mb-1"
            >
              <Coins className="w-4 h-4" aria-hidden="true" />
              Asset type
            </label>
            <select
              id={`${formId}-asset`}
              name="asset"
              value={form.asset}
              onChange={(e) => setField('asset', e.target.value)}
              onBlur={() => handleFieldBlur('asset')}
              aria-invalid={!!showError('asset')}
              aria-describedby={
                showError('asset')
                  ? `${formId}-asset-error`
                  : `${formId}-asset-help`
              }
              className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                showError('asset') ? 'border-red-500' : 'border-input'
              }`}
            >
              {SUPPORTED_POOL_ASSETS.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
            <div className="flex justify-between items-center mt-1">
              {showError('asset') ? (
                <p
                  id={`${formId}-asset-error`}
                  role="alert"
                  className="text-sm text-red-500"
                >
                  {liveErrors.asset}
                </p>
              ) : (
                <p
                  id={`${formId}-asset-help`}
                  className="text-xs text-muted-foreground"
                >
                  Choose the asset for this pool.
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor={`${formId}-depositAmount`}
              className="flex items-center gap-2 text-sm font-medium mb-1"
            >
              <Wallet className="w-4 h-4" aria-hidden="true" />
              Deposit amount
            </label>
            <input
              id={`${formId}-depositAmount`}
              name={DEPOSIT_FIELD}
              type="number"
              inputMode="decimal"
              min={MIN_DEPOSIT_AMOUNT}
              max={MAX_DEPOSIT_AMOUNT}
              step="0.01"
              value={form.depositAmount}
              onChange={(e) => setField('depositAmount', e.target.value)}
              onBlur={() => handleFieldBlur('depositAmount')}
              placeholder={`e.g. 25 (${MIN_DEPOSIT_AMOUNT}–${MAX_DEPOSIT_AMOUNT})`}
              aria-invalid={!!showError('depositAmount')}
              aria-describedby={
                showError('depositAmount')
                  ? `${formId}-depositAmount-error`
                  : `${formId}-depositAmount-help`
              }
              className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                showError('depositAmount') ? 'border-red-500' : 'border-input'
              }`}
            />
            <div className="flex justify-between items-center mt-1">
              {showError('depositAmount') ? (
                <p
                  id={`${formId}-depositAmount-error`}
                  role="alert"
                  className="text-sm text-red-500"
                >
                  {liveErrors.depositAmount}
                </p>
              ) : (
                <p
                  id={`${formId}-depositAmount-help`}
                  className="text-xs text-muted-foreground"
                >
                  Initial deposit or minimum bet for the pool.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Expiry */}
        <div>
          <label
            htmlFor={`${formId}-${EXPIRY_FIELD}`}
            className="flex items-center gap-2 text-sm font-medium mb-1"
          >
            <ArrowLeft className="w-4 h-4 rotate-90" aria-hidden="true" />
            Expiry (seconds)
          </label>
          <input
            id={`${formId}-${EXPIRY_FIELD}`}
            name={EXPIRY_FIELD}
            type="number"
            min={MIN_POOL_DURATION_SECS}
            max={MAX_POOL_DURATION_SECS}
            step="1"
            value={form.expirySeconds}
            onChange={(e) => setField('expirySeconds', e.target.value)}
            onBlur={() => handleFieldBlur('expirySeconds')}
            placeholder={`e.g. 86400 (${MIN_POOL_DURATION_SECS}–${MAX_POOL_DURATION_SECS.toLocaleString()})`}
            aria-invalid={!!showError('expirySeconds')}
            aria-describedby={
              showError('expirySeconds')
                ? `${formId}-${EXPIRY_FIELD}-error`
                : `${formId}-${EXPIRY_FIELD}-help`
            }
            className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              showError('expirySeconds') ? 'border-red-500' : 'border-input'
            }`}
          />
          <div className="flex justify-between items-center mt-1">
            {showError('expirySeconds') ? (
              <p
                id={`${formId}-${EXPIRY_FIELD}-error`}
                role="alert"
                className="text-sm text-red-500"
              >
                {liveErrors.expirySeconds}
              </p>
            ) : (
              <p
                id={`${formId}-${EXPIRY_FIELD}-help`}
                className="text-xs text-muted-foreground"
              >
                How long until the pool expires. ({MIN_POOL_DURATION_SECS}–
                {MAX_POOL_DURATION_SECS.toLocaleString()} seconds)
              </p>
            )}
            {humaniseSeconds(form.expirySeconds) && (
              <span className="text-xs text-muted-foreground">
                {humaniseSeconds(form.expirySeconds)}
              </span>
            )}
          </div>
        </div>

        {/* Status banner */}
        {txHash && (
          <div
            role="status"
            data-testid="pool-success-banner"
            className="p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
          >
            <p className="font-semibold">Pool created!</p>
            <p className="text-sm mt-1 font-mono break-all">Tx: {txHash}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={resetForm}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-60"
            data-testid="create-pool-submit"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? getStageLabel(stage) : 'Create pool'}
          </button>
        </div>
      </form>
    </>
  );
}

export default CreatePoolForm;
