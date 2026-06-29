'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('page');

import { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useToast } from '../../providers/ToastProvider';
import { predinexContract } from '../lib/adapters/predinex-contract';
import { invalidateOnCreatePool } from '../lib/cache-invalidation';
import { TxStage } from '../lib/soroban-transaction-service';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { useCreateWizard, type WizardStep } from './_wizard/useCreateWizard';
import { StepIndicator } from './_wizard/StepIndicator';
import { StepQuestion } from './_wizard/StepQuestion';
import { StepParameters } from './_wizard/StepParameters';
import { StepReview } from './_wizard/StepReview';

export default function CreateMarket() {
  const wallet = useWallet();
  const { showToast } = useToast();
  const wizard = useCreateWizard();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<TxStage>('idle');
  const [txId, setTxId] = useState<string | null>(null);
  const [feePrompt, setFeePrompt] = useState<
    { feeStroops: string; resolve: (v: boolean) => void } | null
  >(null);

  const getStageLabel = (s: TxStage) => {
    switch (s) {
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
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!wallet.isConnected) {
      wallet.connect();
      return;
    }

    const { valid } = wizard.validateAll();
    if (!valid) {
      // Send the user back to the earliest step with an error.
      if (
        wizard.errors.title ||
        wizard.errors.description ||
        wizard.errors.outcomeA ||
        wizard.errors.outcomeB
      ) {
        wizard.goTo(1);
      } else if (wizard.errors.duration) {
        wizard.goTo(2);
      }
      return;
    }

    const duration = parseInt(wizard.draft.duration, 10);
    setIsSubmitting(true);
    setStage('idle');
    try {
      const { txHash } = await predinexContract.createMarketSoroban({
        wallet,
        title: wizard.draft.title,
        description: wizard.draft.description,
        outcomeA: wizard.draft.outcomeA,
        outcomeB: wizard.draft.outcomeB,
        durationSeconds: duration,
        onStageChange: (s) => setStage(s),
        onFeeEstimated: (fee) => {
          return new Promise((resolve) => {
            setFeePrompt({ feeStroops: fee, resolve });
          });
        },
      });

      setTxId(txHash);
      wizard.resetDraft();
      invalidateOnCreatePool();
      showToast('Market created successfully!', 'success');
    } catch (error) {
      log.error('Failed to create market:', error);
      showToast(
        `Failed to create market: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setIsSubmitting(false);
      setStage('idle');
      setFeePrompt(null);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <RouteErrorBoundary routeName="CreateMarket">
      <AuthGuard>
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <h1 className="text-3xl font-bold mb-8">Create new market</h1>

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
            }}
            isConfirming={stage === 'signing' || stage === 'submitting' || stage === 'polling'}
          />

          {txId && (
            <div
              role="status"
              className="mb-6 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
            >
              <p className="font-semibold">Market created!</p>
              <p className="text-sm mt-1 font-mono break-all">Tx: {txId}</p>
            </div>
          )}

          <StepIndicator current={wizard.step} onJump={(target) => wizard.goTo(target)} />

          <form onSubmit={handleSubmit} noValidate>
            <div className="p-6 rounded-xl border border-border">
              {wizard.step === 1 && (
                <StepQuestion
                  draft={wizard.draft}
                  errors={wizard.errors}
                  touched={wizard.touched}
                  setField={wizard.setField}
                  blurField={wizard.blurField}
                />
              )}
              {wizard.step === 2 && (
                <StepParameters
                  draft={wizard.draft}
                  errors={wizard.errors}
                  touched={wizard.touched}
                  setField={wizard.setField}
                  blurField={wizard.blurField}
                />
              )}
              {wizard.step === 3 && (
                <StepReview
                  draft={wizard.draft}
                  walletAddress={wallet.address}
                  onEdit={(s: WizardStep) => wizard.goTo(s)}
                />
              )}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={wizard.resetDraft}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear draft
                </button>
              </div>

              <div className="flex items-center gap-3">
                {wizard.step > 1 && (
                  <button
                    type="button"
                    onClick={wizard.prev}
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/40 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                )}
                {!wizard.isFinalStep ? (
                  <button
                    type="button"
                    onClick={wizard.next}
                    disabled={isSubmitting}
                    aria-disabled={!wizard.canAdvance}
                    className={`px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 ${
                      wizard.canAdvance ? '' : 'opacity-60'
                    }`}
                  >
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isSubmitting ? getStageLabel(stage) : 'Create market'}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </AuthGuard>
      </RouteErrorBoundary>
    </main>
  );
}
