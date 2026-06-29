/**
 * Mock data and test utilities for pool activity
 * 
 * Use for development and testing before connecting to real Soroban events
 */

import type { PoolActivityEvent } from './pool-activity';

/**
 * Generate mock pool activity events for testing
 * @param poolId Pool ID to generate events for
 * @param count Number of events to generate
 * @returns Array of mock PoolActivityEvent items
 */
export function generateMockPoolActivityEvents(
  poolId: number,
  count: number = 10
): PoolActivityEvent[] {
  const baseTimestamp = Math.floor(Date.now() / 1000);
  const addresses = [
    'SP2WXCH12FZAQHW14H8ZZ0H6V2JRPBSK96P89CKD',
    'SPZ8QW98ZETQWC8VWFM8YV2XACW8B3HXNX3PQRH',
    'SP3VXNW7ZCWQE1K2F3G4H5J6K7L8M9N0P1Q2R3S4',
    'SP4XYZA1B2C3D4E5F6G7H8J9K0L1M2N3O4P5Q6R7',
    'SP5BCDE1F2G3H4J5K6L7M8N9O0P1Q2R3S4T5U6V7',
  ];

  const eventTypes = [
    'pool-created',
    'bet-placed',
    'bet-cancelled',
    'pool-settled',
    'claim-processed',
    'dispute-filed',
    'duration-extended',
  ] as const;

  const events: PoolActivityEvent[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = baseTimestamp - i * 3600; // One event per hour
    const actor = addresses[i % addresses.length];
    const type = eventTypes[i % eventTypes.length];
    const hasAmount = ['bet-placed', 'claim-processed'].includes(type);
    const hasOutcome = ['bet-placed', 'pool-settled'].includes(type);

    events.push({
      id: `${poolId}-${timestamp}-${i}`,
      type,
      poolId,
      actor,
      timestamp,
      txHash: `0x${Math.random().toString(16).slice(2)}`,
      explorerUrl: `https://explorer.stellar.org/transactions/0x${Math.random().toString(16).slice(2)}`,
      amount: hasAmount ? Math.floor(Math.random() * 1000000) * 1000000 : undefined,
      outcome: hasOutcome ? Math.floor(Math.random() * 2) : undefined,
      status: 'success',
    });
  }

  return events;
}

/**
 * Get mock event for testing specific event type
 */
export function getMockEventByType(
  type: PoolActivityEvent['type'],
  poolId: number = 1,
  overrides: Partial<PoolActivityEvent> = {}
): PoolActivityEvent {
  const baseEvent: PoolActivityEvent = {
    id: `mock-${type}-${poolId}`,
    type,
    poolId,
    actor: 'SP2WXCH12FZAQHW14H8ZZ0H6V2JRPBSK96P89CKD',
    timestamp: Math.floor(Date.now() / 1000),
    txHash: '0xabcdef123456',
    explorerUrl: 'https://explorer.stellar.org/transactions/0xabcdef123456',
    status: 'success',
  };

  // Add amount for certain event types
  if (['bet-placed', 'claim-processed'].includes(type)) {
    baseEvent.amount = 50000000; // 50 STX
  }

  // Add outcome for certain event types
  if (['bet-placed', 'pool-settled'].includes(type)) {
    baseEvent.outcome = 0;
  }

  return { ...baseEvent, ...overrides };
}
