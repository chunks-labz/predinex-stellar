import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OracleManagementPage from '../../app/oracle-management/page';
import { ORACLE_MANAGEMENT_PLACEHOLDER_FLAG } from '../../app/lib/feature-flags';
import { __resetRuntimeConfigForTests } from '../../app/lib/runtime-config';

describe('OracleManagement route', () => {
  const originalFlagValue = process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];
  const originalOracleAddress = process.env.NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS;

  beforeEach(() => {
    delete process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];
    delete process.env.NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS;
    __resetRuntimeConfigForTests();
  });

  afterEach(() => {
    if (originalFlagValue === undefined) {
      delete process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];
    } else {
      process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG] = originalFlagValue;
    }
    if (originalOracleAddress === undefined) {
      delete process.env.NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS;
    } else {
      process.env.NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS = originalOracleAddress;
    }
    __resetRuntimeConfigForTests();
  });

  it('hides mock oracle actions when the placeholder flag is disabled', () => {
    render(<OracleManagementPage />);

    expect(screen.getByText(/oracle management is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/oracle management preview/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /register preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /registration preview only/i })).not.toBeInTheDocument();
  });

  it('labels the placeholder path when the flag is intentionally enabled', async () => {
    process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG] = 'true';

    const user = userEvent.setup();
    render(<OracleManagementPage />);

    expect(screen.getByRole('status', { name: /oracle management placeholder status/i }))
      .toHaveTextContent(/placeholder oracle management preview/i);
    expect(screen.getByRole('status', { name: /oracle management placeholder status/i }))
      .toHaveTextContent(ORACLE_MANAGEMENT_PLACEHOLDER_FLAG);

    await user.click(screen.getByRole('button', { name: /register preview/i }));

    expect(screen.getByRole('heading', { name: /register provider preview/i }))
      .toBeInTheDocument();
    expect(screen.getByRole('group', { name: /oracle registration preview fields/i }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: /registration preview only/i }))
      .toBeDisabled();
  });

  it('uses the generic Stellar placeholder when NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS is not set', async () => {
    process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG] = 'true';
    // NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS intentionally unset

    const user = userEvent.setup();
    render(<OracleManagementPage />);

    await user.click(screen.getByRole('button', { name: /register preview/i }));

    const input = screen.getByRole('textbox', { hidden: true });
    expect(input).toHaveAttribute('placeholder', 'G... (Stellar account address)');
  });

  it('pre-fills the oracle address placeholder from runtime-config when NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS is set', async () => {
    const testAddress = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG] = 'true';
    process.env.NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS = testAddress;
    __resetRuntimeConfigForTests();

    const user = userEvent.setup();
    render(<OracleManagementPage />);

    await user.click(screen.getByRole('button', { name: /register preview/i }));

    const input = screen.getByRole('textbox', { hidden: true });
    expect(input).toHaveAttribute('placeholder', testAddress);
  });
});
