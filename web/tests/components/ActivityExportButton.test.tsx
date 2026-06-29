import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, render as rtlRender } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ToastProvider } from '../../providers/ToastProvider';
import ActivityExportButton from '../../app/components/ActivityExportButton';
import type { ActivityItem } from '../../app/lib/stacks-api';

// Wrap with only ToastProvider — the component's sole context dependency — to
// avoid the wallet/AppKit provider chain pulled in by the shared test-utils.
const render = (ui: ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

function makeActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    txId: '0xabc',
    type: 'bet-placed',
    functionName: 'place-bet',
    timestamp: Date.parse('2026-03-15T12:00:00.000Z') / 1000,
    status: 'success',
    amount: 2_500_000,
    poolId: 7,
    poolTitle: 'Will it rain?',
    explorerUrl: 'https://explorer.example/tx/0xabc',
    ...overrides,
  };
}

describe('ActivityExportButton', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let capturedContent: string | null;

  beforeEach(() => {
    capturedContent = null;
    // jsdom's Blob lacks a usable text() reader, so stub it to record the
    // serialized content the component passes in.
    vi.stubGlobal(
      'Blob',
      class MockBlob {
        type: string | undefined;
        constructor(parts: string[], opts?: { type?: string }) {
          capturedContent = (parts ?? []).join('');
          this.type = opts?.type;
        }
      }
    );
    createObjectURL = vi.fn(() => 'blob:mock');
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /export/i }));

  it('downloads CSV with the documented header and a row per activity', async () => {
    render(
      <ActivityExportButton activities={[makeActivity()]} fromDate="2026-03-01" toDate="2026-03-31" />
    );

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /csv/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const lines = capturedContent!.split('\n');
    expect(lines[0]).toBe('pool_id,type,amount,timestamp,tx_hash,pool_title');
    expect(lines[1]).toBe('7,bet-placed,2.5,2026-03-15T12:00:00.000Z,0xabc,Will it rain?');
  });

  it('downloads valid JSON when JSON is chosen', () => {
    render(
      <ActivityExportButton activities={[makeActivity()]} fromDate="2026-03-01" toDate="2026-03-31" />
    );

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /json/i }));

    expect(capturedContent).not.toBeNull();
    const parsed = JSON.parse(capturedContent!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ poolId: 7, type: 'bet-placed', amount: 2.5, txHash: '0xabc' });
  });

  it('does not download when the date range excludes every activity', () => {
    render(
      <ActivityExportButton activities={[makeActivity()]} fromDate="2026-01-01" toDate="2026-01-31" />
    );

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /csv/i }));

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
