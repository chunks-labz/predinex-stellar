'use client';

import { createAppKit } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { WALLETCONNECT_PROJECT_ID, stellarNetworks, appKitMetadata } from '../lib/appkit-config';

const queryClient = new QueryClient();

// Initialize AppKit against Stellar networks. AppKit's typed `networks` field
// expects its built-in CaipNetwork union; Stellar is configured as a CAIP-2
// network here, so we cast to the runtime shape AppKit accepts.
createAppKit({
  projectId: WALLETCONNECT_PROJECT_ID,
  networks: [stellarNetworks.mainnet, stellarNetworks.testnet] as unknown as Parameters<
    typeof createAppKit
  >[0]['networks'],
  metadata: appKitMetadata,
  features: {
    analytics: true,
  }
});

export function AppKitProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
