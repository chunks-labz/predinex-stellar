/**
 * Read-only Soroban helpers for on-chain pool templates.
 */
import {
  Account,
  Contract,
  Networks,
  rpc,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { getRuntimeConfig } from './runtime-config';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('sorobanTemplateApi');

/** On-chain pool template shape returned by `get_public_templates`. */
export interface OnChainPoolTemplate {
  id: number;
  title: string;
  description: string;
  outcomes: string[];
  duration: number;
  metadataUri: string | null;
  isPublic: boolean;
}

interface RawOnChainTemplate {
  id?: number | bigint;
  title?: string;
  description?: string;
  outcomes?: string[];
  duration?: number | bigint;
  metadata_uri?: string | null;
  is_public?: boolean;
}

function normalizeTemplate(raw: RawOnChainTemplate): OnChainPoolTemplate | null {
  if (!raw.title || !raw.description || !Array.isArray(raw.outcomes)) {
    return null;
  }
  return {
    id: Number(raw.id ?? 0),
    title: raw.title,
    description: raw.description,
    outcomes: raw.outcomes.filter((o) => typeof o === 'string'),
    duration: Number(raw.duration ?? 0),
    metadataUri: raw.metadata_uri ?? null,
    isPublic: Boolean(raw.is_public),
  };
}

/**
 * Simulate `get_public_templates` against the configured Predinex contract.
 */
export async function getPublicTemplatesFromSoroban(): Promise<OnChainPoolTemplate[]> {
  const { soroban, network } = getRuntimeConfig();
  if (!soroban.contractId) {
    return [];
  }

  try {
    const server = new rpc.Server(soroban.rpcUrl);
    const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
    const contract = new Contract(soroban.contractId);
    const source = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0'
    );

    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: passphrase,
    })
      .addOperation(contract.call('get_public_templates'))
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      log.error('get_public_templates simulation failed:', simulation.error);
      return [];
    }

    const retval = simulation.result?.retval;
    if (!retval) return [];

    const native = scValToNative(retval) as RawOnChainTemplate[];
    if (!Array.isArray(native)) return [];

    return native
      .map((entry) => normalizeTemplate(entry))
      .filter((entry): entry is OnChainPoolTemplate => entry !== null);
  } catch (error) {
    log.error('Failed to fetch public templates:', error);
    return [];
  }
}
