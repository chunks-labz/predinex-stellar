/**
 * #1303 — `create_pool_from_template` must be called with the contract's
 * arguments: `(creator, template_id, amount, overrides)`.
 *
 * The builder used to send three arguments, dropping the creator deposit, so
 * the host rejected every template pool. These tests decode the operation the
 * service actually builds and compare it with the signature in the contract
 * source, so a future arity change on either side fails here instead of in a
 * user's wallet.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, Transaction, scValToNative, xdr } from '@stellar/stellar-sdk';
import { SorobanTransactionService } from '../../app/lib/soroban-transaction-service';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import type { FreighterWalletClient } from '../../app/lib/freighter-adapter';

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({
    network: 'testnet',
    soroban: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    },
  }),
}));

const WALLET_ADDRESS = 'GBOESPHCY6X32EBI2NTLD646XVF4EOYB6CBXVHRNRFXIBUHT733JERWI';
const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const LIB_RS = path.resolve(__dirname, '../../../contracts/predinex/src/lib.rs');

/** Parameter names of a contract entry point, excluding `env`. */
function contractParams(fnName: string): string[] {
  const source = readFileSync(LIB_RS, 'utf8');
  const match = source.match(new RegExp(`pub fn ${fnName}\\s*\\(([\\s\\S]*?)\\)\\s*->`));
  if (!match) throw new Error(`${fnName} not found in ${LIB_RS}`);
  return match[1]
    .split(',')
    .map((param) => param.trim().split(':')[0].trim())
    .filter((name) => name.length > 0 && name !== 'env');
}

/** Builds the transaction without simulating or submitting it. */
async function buildTemplateCall(params: Parameters<SorobanTransactionService['createPoolFromTemplate']>[2]) {
  const service = new SorobanTransactionService('https://soroban-testnet.stellar.org', 'testnet');
  const internals = service as unknown as {
    server: { getAccount: (address: string) => Promise<Account> };
    executeWithFeePrompt: (tx: Transaction) => Promise<unknown>;
  };
  vi.spyOn(internals.server, 'getAccount').mockResolvedValue(new Account(WALLET_ADDRESS, '1'));
  const execute = vi
    .spyOn(internals, 'executeWithFeePrompt')
    .mockResolvedValue({ status: 'SUCCESS', txHash: 'hash' });

  const wallet = { address: WALLET_ADDRESS } as unknown as FreighterWalletClient;
  await service.createPoolFromTemplate(wallet, CONTRACT_ID, params);

  const tx = execute.mock.calls[0][0] as Transaction;
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') throw new Error(`unexpected operation ${op.type}`);
  const invocation = op.func.invokeContract();
  return {
    functionName: invocation.functionName().toString(),
    args: invocation.args(),
  };
}

describe('SorobanTransactionService.createPoolFromTemplate (#1303)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the contract signature (creator, template_id, amount, overrides)', async () => {
    expect(contractParams('create_pool_from_template')).toEqual([
      'creator',
      'template_id',
      'amount',
      'overrides',
    ]);

    const { functionName, args } = await buildTemplateCall({
      templateId: 3,
      amountStroops: 10_000_000,
      overrides: {},
    });

    expect(functionName).toBe('create_pool_from_template');
    expect(args).toHaveLength(contractParams('create_pool_from_template').length);
  });

  it('encodes the creator deposit as an i128 in the amount position', async () => {
    const { args } = await buildTemplateCall({
      templateId: 7,
      amountStroops: 25_000_000,
      overrides: {},
    });

    expect(scValToNative(args[0])).toBe(WALLET_ADDRESS);
    expect(args[1].switch()).toBe(xdr.ScValType.scvU32());
    expect(scValToNative(args[1])).toBe(7);
    expect(args[2].switch()).toBe(xdr.ScValType.scvI128());
    expect(scValToNative(args[2])).toBe(25_000_000n);
  });

  it('encodes overrides as a symbol-keyed PoolTemplateOverrides struct', async () => {
    const { args } = await buildTemplateCall({
      templateId: 1,
      amountStroops: 10_000_000,
      overrides: { title: 'Custom title', outcomes: ['Yes', 'No', 'Maybe'], duration: 86_400 },
    });

    const overrides = args[3];
    expect(overrides.switch()).toBe(xdr.ScValType.scvMap());
    const entries = overrides.map() ?? [];
    expect(entries.map((entry) => entry.key().switch())).toEqual(
      entries.map(() => xdr.ScValType.scvSymbol())
    );
    expect(entries.map((entry) => entry.key().sym().toString())).toEqual([
      'description',
      'duration',
      'metadata_uri',
      'outcomes',
      'title',
    ]);

    const byKey = Object.fromEntries(entries.map((entry) => [entry.key().sym().toString(), entry.val()]));
    expect(byKey.title.switch()).toBe(xdr.ScValType.scvString());
    expect(byKey.duration.switch()).toBe(xdr.ScValType.scvU64());
    expect(scValToNative(byKey.duration)).toBe(86_400n);
    expect(scValToNative(byKey.outcomes)).toEqual(['Yes', 'No', 'Maybe']);
    expect(byKey.description.switch()).toBe(xdr.ScValType.scvVoid());
    expect(byKey.metadata_uri.switch()).toBe(xdr.ScValType.scvVoid());
  });
});

describe('predinexContract.createPoolFromTemplateSoroban (#1303)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the creator deposit through to the transaction service', async () => {
    const createPoolFromTemplate = vi
      .spyOn(SorobanTransactionService.prototype, 'createPoolFromTemplate')
      .mockResolvedValue({ status: 'SUCCESS', txHash: 'tx-hash' });
    const wallet = { address: WALLET_ADDRESS } as unknown as FreighterWalletClient;

    const result = await predinexContract.createPoolFromTemplateSoroban({
      wallet,
      templateId: 4,
      amountStroops: 12_000_000,
      overrides: { durationSeconds: 3_600 },
    });

    expect(result).toEqual({ txHash: 'tx-hash' });
    expect(createPoolFromTemplate).toHaveBeenCalledWith(
      wallet,
      CONTRACT_ID,
      expect.objectContaining({
        templateId: 4,
        amountStroops: 12_000_000,
        overrides: expect.objectContaining({ duration: 3_600 }),
      }),
      undefined,
      undefined
    );
  });
});
