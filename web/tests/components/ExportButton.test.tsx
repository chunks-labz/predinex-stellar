import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportButton from '../../components/ExportButton';
import { renderWithProviders } from '../helpers/renderWithProviders';

// Mock fetch and URL APIs
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

function csvResponse(body = 'Date,Pool ID,Question,Outcome,Amount,Result,Payout\n') {
  return Promise.resolve(
    new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/csv' },
    })
  );
}

describe('ExportButton', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
  });

  it('renders the export button', () => {
    renderWithProviders(<ExportButton address="GTEST123" />);
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
  });

  it('renders date range selector', () => {
    renderWithProviders(<ExportButton address="GTEST123" />);
    expect(screen.getByRole('combobox', { name: /date range/i })).toBeInTheDocument();
  });

  it('shows custom date inputs when custom range selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportButton address="GTEST123" />);
    await user.selectOptions(screen.getByRole('combobox', { name: /date range/i }), 'custom');
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it('disables export button when custom range selected but dates not filled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportButton address="GTEST123" />);
    await user.selectOptions(screen.getByRole('combobox', { name: /date range/i }), 'custom');
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();
  });

  it('calls fetch with correct address and triggers download on success', async () => {
    const user = userEvent.setup();
    mockFetch.mockReturnValue(csvResponse());

    renderWithProviders(<ExportButton address="GTEST123" />);
    await user.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('address=GTEST123');
    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
  });

  it('shows loading state while exporting', async () => {
    const user = userEvent.setup();
    let resolve!: (v: Response) => void;
    mockFetch.mockReturnValue(new Promise<Response>((r) => { resolve = r; }));

    renderWithProviders(<ExportButton address="GTEST123" />);
    await user.click(screen.getByRole('button', { name: /export csv/i }));

    expect(await screen.findByText(/exporting/i)).toBeInTheDocument();
    resolve(new Response('', { status: 200, headers: { 'Content-Type': 'text/csv' } }));
  });

  it('shows error message on fetch failure', async () => {
    const user = userEvent.setup();
    mockFetch.mockReturnValue(
      Promise.resolve(new Response(JSON.stringify({ error: 'Export failed' }), { status: 500 }))
    );

    renderWithProviders(<ExportButton address="GTEST123" />);
    await user.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/export failed/i));
  });
});
