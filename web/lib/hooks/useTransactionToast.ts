import { useToast } from "@/providers/ToastProvider";
import { TxStage } from "@/app/lib/soroban-transaction-service";
import { toastMessages } from "../toast-messages";
import { useRef } from "react";

/**
 * Hook to manage transaction status toast notifications.
 * Provides an onStageChange callback that updates a toast based on the transaction stage.
 */
export function useTransactionToast() {
  const { showToast, updateToast, removeToast } = useToast();
  const toastIdRef = useRef<string | null>(null);

  const onStageChange = (stage: TxStage) => {
    if (stage === "idle") {
      // Only remove if it's still in a loading state.
      // If it's success or error, let it persist/auto-dismiss.
      return;
    }

    if (!toastIdRef.current) {
      toastIdRef.current = showToast(
        toastMessages.transaction.pending.message,
        "loading",
      );
    }

    switch (stage) {
      case "simulating":
        updateToast(toastIdRef.current, "Simulating transaction...", "loading");
        break;
      case "signing":
        updateToast(
          toastIdRef.current,
          "Waiting for wallet signature...",
          "loading",
        );
        break;
      case "submitting":
        updateToast(toastIdRef.current, "Submitting to network...", "loading");
        break;
      case "polling":
        updateToast(toastIdRef.current, "Confirming transaction...", "loading");
        break;
      case "success":
        updateToast(
          toastIdRef.current,
          toastMessages.transaction.confirmed.message,
          "success",
        );
        toastIdRef.current = null; // Clear ref so next transaction starts fresh
        break;
      case "error":
        toastIdRef.current = null;
        // Errors are usually handled via showError for more detail
        break;
    }
  };

  const showError = (error: string) => {
    const message = `Transaction failed: ${error}`;
    if (toastIdRef.current) {
      updateToast(toastIdRef.current, message, "error");
      toastIdRef.current = null;
    } else {
      showToast(message, "error");
    }
  };

  const showSuccess = (message?: string) => {
    const msg = message || toastMessages.transaction.confirmed.message;
    if (toastIdRef.current) {
      updateToast(toastIdRef.current, msg, "success");
      toastIdRef.current = null;
    } else {
      showToast(msg, "success");
    }
  };

  const dismiss = () => {
    if (toastIdRef.current) {
      removeToast(toastIdRef.current);
      toastIdRef.current = null;
    }
  };

  return { onStageChange, showError, showSuccess, dismiss };
}
