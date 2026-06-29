import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OracleManagementPage from '../../app/oracle-management/page';
import { ORACLE_MANAGEMENT_PLACEHOLDER_FLAG } from '../../app/lib/feature-flags';

describe('OracleManagement route', () => {
  const originalFlagValue = process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];

  beforeEach(() => {
    delete process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];
  });

  afterEach(() => {
    if (originalFlagValue === undefined) {
      delete process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];
    } else {
      process.env[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG] = originalFlagValue;
    }
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
});
