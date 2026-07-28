import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('fetchDisputesFromContract');
import { getPool } from '../stacks-api';
import type { Dispute } from './types';

export async function fetchDisputesFromContract(): Promise<Dispute[]> {
  try {
    const cfg = await import('../runtime-config').then((m) => m.getRuntimeConfig());
    const response = await fetch(
      `${cfg.api.coreApiUrl}/extended/v1/contract/${cfg.contract.address}/${cfg.contract.name}/events?limit=100`
    );
    const data = await response.json();

    const disputes: Dispute[] = [];
    const events = data.results || [];

    for (const event of events) {
      if (event.event === 'smart_contract_event' && event.data.event_name === 'dispute-created') {
        const eventData = event.data.event_data;
        const pool = await getPool(eventData.pool_id);

        disputes.push({
          id: Number(eventData.dispute_id),
          poolId: Number(eventData.pool_id),
          poolTitle: pool?.title || `Pool #${eventData.pool_id}`,
          disputer: eventData.disputer,
          disputeBond: Number(eventData.bond),
          disputeReason: eventData.reason || 'Dispute reason not available',
          votingDeadline: Number(eventData.voting_deadline),
          votesFor: 0,
          votesAgainst: 0,
          status: 'active',
          createdAt: Number(eventData.created_at),
        });
      }
    }

    return disputes;
  } catch (error) {
    log.error('Failed to fetch disputes from contract:', error);
    return [];
  }
}
