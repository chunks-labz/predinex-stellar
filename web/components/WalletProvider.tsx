"use client";

/**
 * WalletProvider - React Context Provider for wallet authentication
 *
 * This component manages the authentication state for the entire application,
 * providing wallet connection and authentication functions to child components
 * through React Context.
 *
 * Supports Stellar/Soroban wallets via Freighter and WalletConnect.
 */

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import WalletModal from "@/components/WalletModal";
import { createScopedLogger } from "../lib/logger";

const log = createScopedLogger("WalletProvider");

/**
 * Interface defining the shape of the wallet context value
 * Available to all components that use the useWallet hook
 */
interface WalletContextValue {
  /** Current wallet address, null if not connected */
  walletAddress: string | null;
  /** Function to manually set wallet address */
  setWalletAddress: (address: string | null) => void;
  /** Function to sign out the current user */
  signOut: () => void;
  /** Function to initiate wallet connection flow */
  authenticate: () => void;
  /** Function to open wallet selection modal */
  openWalletModal: () => void;
  /** Loading state during authentication initialization */
  isLoading: boolean;
}

export type WalletType = "freighter" | "walletconnect";

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

/**
 * WalletProvider is the root context provider for wallet-related functionality.
 * It initializes the authentication session, handles sign-ins, and provides
 * a unified interface for wallet interactions to the rest of the application.
 *
 * @param children - The React components to be wrapped by the provider
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  // State for storing wallet address
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  // Tracks initial session verification to prevent flickers or unauthorized access
  const [isLoading, setIsLoading] = useState(true);
  // Controls the visibility of the multi-wallet selection modal
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  // Tracks any errors that occur during the wallet connection flow
  const [walletError, setWalletError] = useState<string | undefined>();

  useEffect(() => {
    /**
     * initializeAuth
     * On component mount, check if there is an existing wallet connection.
     */
    const initializeAuth = async () => {
      try {
        // Check for saved wallet address in local storage
        const savedAddress = localStorage.getItem("walletAddress");
        if (savedAddress) {
          setWalletAddress(savedAddress);
        }
      } catch (error) {
        log.error("Error initializing authentication", error);
      } finally {
        // Signal that the app is ready for interaction
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  /**
   * Terminate the wallet session and clear local state.
   */
  const signOut = useCallback(() => {
    localStorage.removeItem("walletAddress");
    setWalletAddress(null);
  }, []);

  /**
   * UI helper to trigger the wallet selection UI.
   */
  const openWalletModal = useCallback(() => {
    setWalletError(undefined);
    setIsWalletModalOpen(true);
  }, []);

  /**
   * Orchestrates the connection flow for a specific wallet provider.
   *
   * @param walletType - The brand of wallet being connected (Freighter, etc.)
   */
  const handleWalletSelection = useCallback(async (walletType: WalletType) => {
    setWalletError(undefined);
    try {
      // Wallet connection logic would go here
      // For now, this is a placeholder
      log.debug("Wallet connection initiated");
      setIsWalletModalOpen(false);
    } catch (error: unknown) {
      log.error(`Wallet connection error for ${walletType}`, error);
      const errorMessage =
        (error instanceof Error ? error.message : String(error)) ||
        "Failed to connect. Please try again.";
      if (
        walletType === "walletconnect" ||
        errorMessage.toLowerCase().includes("unsupported")
      ) {
        setWalletError(
          "Unsupported provider. Please use a Stellar-compatible wallet.",
        );
      } else {
        setWalletError(`Failed to connect to ${walletType}. Please try again.`);
      }
      setIsWalletModalOpen(true);
    }
  }, []);

  /**
   * Main entry point for starting the login flow.
   */
  const authenticate = useCallback(() => {
    openWalletModal();
  }, [openWalletModal]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <WalletContext.Provider
      value={{
        walletAddress,
        setWalletAddress,
        signOut,
        authenticate,
        openWalletModal,
        isLoading,
      }}
    >
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        onSelectWallet={handleWalletSelection}
        error={walletError}
      />
      {children}
    </WalletContext.Provider>
  );
}

/**
 * Custom hook to access the wallet authentication context.
 * Must be used within a component wrapped by WalletProvider.
 *
 * @returns The current WalletContextValue
 */
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
