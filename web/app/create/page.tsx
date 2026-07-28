"use client";
import { createScopedLogger } from "@/app/lib/logger";
const log = createScopedLogger("page");

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import AuthGuard from "@/components/AuthGuard";
import { useWallet } from "@/components/WalletAdapterProvider";
import { useToast } from "../../providers/ToastProvider";
import { useTransactionToast } from "../../lib/hooks/useTransactionToast";
import { predinexContract } from "../lib/adapters/predinex-contract";
import { predinexReadApi } from "../lib/adapters/predinex-read-api";
import { invalidateOnCreatePool } from "../lib/cache-invalidation";
import { TxStage } from "../lib/soroban-transaction-service";
import { TransactionFeeModal } from "@/components/TransactionFeeModal";
import RouteErrorBoundary from "../../components/RouteErrorBoundary";
import { useCreateWizard, type WizardStep } from "./_wizard/useCreateWizard";
import { StepIndicator } from "./_wizard/StepIndicator";
import { StepTemplate } from "./_wizard/StepTemplate";
import { StepBasics } from "./_wizard/StepBasics";
import { StepOutcomes } from "./_wizard/StepOutcomes";
import { StepParameters } from "./_wizard/StepParameters";
import { StepReview } from "./_wizard/StepReview";
import {
  buildPoolMetadataUri,
  loadSavedTemplates,
  parseTemplateDeepLink,
  saveTemplateToLocalStorage,
} from "./_wizard/pool-templates";

export default function CreateMarket() {
  const wallet = useWallet();
  const { showToast } = useToast();
  const {
    onStageChange: onTransactionStageChange,
    showError,
    showSuccess,
  } = useTransactionToast();
  const searchParams = useSearchParams();
  const wizard = useCreateWizard();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<TxStage>("idle");
  const [txId, setTxId] = useState<string | null>(null);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [feePrompt, setFeePrompt] = useState<{
    feeStroops: string;
    resolve: (v: boolean) => void;
  } | null>(null);

  useEffect(() => {
    if (deepLinkHandled) return;
    const parsed = parseTemplateDeepLink(searchParams.get("template"));
    if (!parsed) {
      setDeepLinkHandled(true);
      return;
    }

    let cancelled = false;
    (async () => {
      const publicTemplates = await predinexReadApi.getPublicTemplates();
      if (cancelled) return;
      const savedTemplates = loadSavedTemplates();
      const applied = wizard.applyDeepLinkTemplate(
        parsed.source,
        parsed.id,
        publicTemplates,
        savedTemplates,
      );
      if (applied) {
        wizard.goTo(2);
        showToast("Template loaded from link", "success");
      } else {
        showToast("Template from link was not found", "error");
      }
      setDeepLinkHandled(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    deepLinkHandled,
    searchParams,
    showToast,
    wizard.applyDeepLinkTemplate,
    wizard.goTo,
  ]);

  const getStageLabel = (s: TxStage) => {
    switch (s) {
      case "simulating":
        return "Simulating transaction…";
      case "signing":
        return "Waiting for signature…";
      case "submitting":
        return "Submitting to network…";
      case "polling":
        return "Confirming transaction…";
      default:
        return "Submitting…";
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
      if (wizard.errors.title || wizard.errors.description) {
        wizard.goTo(2);
      } else if (
        Object.keys(wizard.errors).some((key) => key.startsWith("outcome"))
      ) {
        wizard.goTo(3);
      } else {
        wizard.goTo(4);
      }
      return;
    }

    const duration = parseInt(wizard.draft.duration, 10);
    const metadataUri = buildPoolMetadataUri(wizard.draft);
    const outcomes = wizard.draft.outcomes.map((outcome) => outcome.trim());
    const txOptions = {
      onStageChange: (s: TxStage) => setStage(s),
      onFeeEstimated: (fee: string) =>
        new Promise<boolean>((resolve) => {
          setFeePrompt({ feeStroops: fee, resolve });
        }),
    };

    setIsSubmitting(true);
    setStage("idle");
    try {
      const { txHash, poolId } = await predinexContract.createMultiOutcomePoolSoroban({
        wallet,
        title: wizard.draft.title,
        description: wizard.draft.description,
        outcomes: outcomes,
        durationSeconds: duration,
        metadataUri: metadataUri || null,
        onStageChange: (s) => {
          setStage(s);
          onTransactionStageChange(s);
        },
        onFeeEstimated: (fee) => {
          return new Promise((resolve) => {
            setFeePrompt({ feeStroops: fee, resolve });
          });
        },
      });

      // #721 — If any extended metadata fields are filled and we decoded the pool ID,
      // submit them as a second transaction (best-effort, non-blocking on error).
      const { resolutionCriteria, externalLinks, coverImage } = wizard.draft;
      if (poolId && (resolutionCriteria || externalLinks || coverImage)) {
        try {
          await predinexContract.setPoolExtMetadataSoroban({
            wallet,
            poolId,
            resolutionCriteria: resolutionCriteria || undefined,
            externalLinks: externalLinks || undefined,
            coverImage: coverImage || undefined,
          });
        } catch (metaError) {
          log.warn(
            "Extended metadata submission failed (non-fatal):",
            metaError,
          );
          showToast("Pool created — metadata could not be saved.", "error");
        }
      }

      setTxId(txHash);
      wizard.resetDraft();
      invalidateOnCreatePool();
      showSuccess("Pool created successfully!");
    } catch (error) {
      log.error("Failed to create pool:", error);
      showError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
      setStage("idle");
      setFeePrompt(null);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <RouteErrorBoundary routeName="CreateMarket">
        <AuthGuard>
          <div className="container mx-auto px-4 py-8 sm:py-12 max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">
              Create prediction pool
            </h1>
            <p className="text-sm text-muted-foreground mb-8">
              Guided wizard with templates, draft auto-save, and on-chain
              preview before you sign.
            </p>

            <TransactionFeeModal
              isOpen={!!feePrompt}
              actionName="Create Pool"
              feeStroops={feePrompt?.feeStroops || "0"}
              onConfirm={() => {
                feePrompt?.resolve(true);
                setFeePrompt(null);
              }}
              onCancel={() => {
                feePrompt?.resolve(false);
                setFeePrompt(null);
                setIsSubmitting(false);
                setStage("idle");
              }}
              isConfirming={
                stage === "signing" ||
                stage === "submitting" ||
                stage === "polling"
              }
            />

            {txId && (
              <div
                role="status"
                className="mb-6 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
              >
                <p className="font-semibold">Pool created!</p>
                <p className="text-sm mt-1 font-mono break-all">Tx: {txId}</p>
              </div>
            )}

            <StepIndicator
              current={wizard.step}
              onJump={(target) => wizard.goTo(target)}
            />

            <form onSubmit={handleSubmit} noValidate>
              <div className="p-4 sm:p-6 rounded-xl border border-border">
                {wizard.step === 1 && (
                  <StepTemplate
                    draft={wizard.draft}
                    selectTemplate={wizard.selectTemplate}
                  />
                )}
                {wizard.step === 2 && (
                  <StepBasics
                    draft={wizard.draft}
                    errors={wizard.errors}
                    touched={wizard.touched}
                    setField={wizard.setField}
                    blurField={wizard.blurField}
                  />
                )}
                {wizard.step === 3 && (
                  <StepOutcomes
                    draft={wizard.draft}
                    errors={wizard.errors}
                    touched={wizard.touched}
                    setOutcome={wizard.setOutcome}
                    addOutcome={wizard.addOutcome}
                    removeOutcome={wizard.removeOutcome}
                  />
                )}
                {wizard.step === 4 && (
                  <StepParameters
                    draft={wizard.draft}
                    errors={wizard.errors}
                    touched={wizard.touched}
                    setField={wizard.setField}
                    blurField={wizard.blurField}
                  />
                )}
                {wizard.step === 5 && (
                  <StepReview
                    draft={wizard.draft}
                    walletAddress={wallet.address}
                    onEdit={(s: WizardStep) => wizard.goTo(s)}
                    setField={wizard.setField}
                  />
                )}
              </div>

              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
                <button
                  type="button"
                  onClick={wizard.resetDraft}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear draft
                </button>

                <div className="flex items-center justify-end gap-3">
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
                        wizard.canAdvance ? "" : "opacity-60"
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
                      {isSubmitting && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      {isSubmitting
                        ? getStageLabel(stage)
                        : "Create pool on-chain"}
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
