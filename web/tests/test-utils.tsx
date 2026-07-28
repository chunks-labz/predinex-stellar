import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { WalletProvider } from '@/components/WalletProvider';
import { ToastProvider } from '../providers/ToastProvider';

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <WalletProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </WalletProvider>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
