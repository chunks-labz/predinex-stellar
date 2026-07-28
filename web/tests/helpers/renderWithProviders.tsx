import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../providers/ToastProvider';
import { ThemeProvider } from '../../lib/theme';
import { I18nProvider } from '../../app/lib/i18n';
import { WalletAdapterProvider } from '@/components/WalletAdapterProvider';

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  withQueryClient?: boolean;
}

function buildWrapper(options: RenderWithProvidersOptions = {}) {
  const { withQueryClient = false } = options;

  return function Wrapper({ children }: { children: React.ReactNode }) {
    let tree = (
      <I18nProvider>
        <ThemeProvider>
          <WalletAdapterProvider>
            <ToastProvider>{children}</ToastProvider>
          </WalletAdapterProvider>
        </ThemeProvider>
      </I18nProvider>
    );

    if (withQueryClient) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      tree = <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>;
    }

    return tree;
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const { withQueryClient, ...renderOptions } = options;
  return render(ui, { wrapper: buildWrapper({ withQueryClient }), ...renderOptions });
}
