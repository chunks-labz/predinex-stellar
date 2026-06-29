/**
 * Test mock surface guide.
 *
 * Preferred surfaces for production-facing suites:
 * - `predinexReadApi` and `predinexContract` adapter modules
 * - `getUserActivityFromSoroban` and other Soroban event helpers
 * - `fetch` responses shaped like Soroban RPC / REST JSON
 *
 * Compatibility-only surfaces, if a legacy test still needs them:
 * - `@stacks/transactions`
 * - `@stacks/network`
 * - `@stacks/connect`
 *
 * Keep the legacy surfaces isolated to compatibility suites so adapter and
 * transaction tests continue to reflect the current Soroban-oriented product
 * shape.
 */

export type SorobanRpcEvent = {
  id: string;
  txHash: string;
  ledgerClosedAt?: string;
  ledger?: number;
  contractId?: string;
  topic: unknown[];
  value: unknown;
};

export function makeSorobanEvent(overrides: Partial<SorobanRpcEvent> = {}): SorobanRpcEvent {
  return {
    id: 'ledger-001',
    txHash: '0xabc123',
    ledgerClosedAt: '2024-01-15T10:00:00Z',
    ledger: 100,
    contractId: 'CTEST123CONTRACT',
    topic: [
      { type: 'symbol', value: 'place_bet' },
      { type: 'symbol', value: 'v1' },
      { type: 'u32', value: 5 },
      { type: 'address', value: 'GBUSER123STELLARADDRESS' },
    ],
    value: [0, 5_000_000],
    ...overrides,
  };
}

export function makeSorobanEventsResponse(events: SorobanRpcEvent[]) {
  return {
    result: {
      events,
    },
  };
}
