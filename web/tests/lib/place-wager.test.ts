/**
 * #1439 — Typed SDK helper for the place-wager flow.
 *
 * Covers outcome encoding, amount/pool/referrer validation (fail fast, clear
 * errors), the structured result carrying the transaction hash, and the actual
 * `place_bet` XDR arguments built for the contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  scValToNative,
  Transaction,
  xdr,
} from '@stellar/stellar-sdk';
import {
  encodeWagerOutcome,
  MAX_WAGER_STROOPS,
  MIN_WAGER_STROOPS,
  normalizePlaceWagerParams,
  placeWager,
  PlaceBetSubmitter,
  validatePoolId,
  validateReferrer,
  validateWagerAmount,
  WagerValidationError,
} from '../../app/lib/place-wager';
import { SorobanTransactionService } from '../../app/lib/soroban-transaction-service';
import type { FreighterWalletClient } from '../../app/lib/freighter-adapter';

const CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({
    network: 'testnet',
    soroban: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      contractId: CONTRACT_ID,
    },
  }),
}));

const WALLET_ADDRESS = 'GDL5T7I4PIPB54BFZHAACZZDVEXI5TID5WIKBHACBJ5VWJMWJZKK64XM';
const REFERRER = 'GAT3VET7ZWHAOMXE46OPSD6XCIGH5PYTOQDTVYKVX3RK3CCAOAFX5G5K';

function wallet(address: string = WALLET_ADDRESS): FreighterWalletClient {
  return { address } as unknown as FreighterWalletClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encodeWagerOutcome (#1439)', () => {
  it('maps A/a/0 to 0 and B/b/1 to 1', () => {
    expect(encodeWagerOutcome(0)).toBe(0);
    expect(encodeWagerOutcome('A')).toBe(0);
    expect(encodeWagerOutcome('a')).toBe(0);
    expect(encodeWagerOutcome(1)).toBe(1);
    expect(encodeWagerOutcome('B')).toBe(1);
    expect(encodeWagerOutcome('b')).toBe(1);
  });

  it('rejects unsupported outcomes with a clear error', () => {
    for (const invalid of [2, -1, 1.5, 'C', 'yes', null, undefined]) {
      expect(() => encodeWagerOutcome(invalid)).toThrow(WagerValidationError);
      try {
        encodeWagerOutcome(invalid);
      } catch (error) {
        expect((error as WagerValidationError).field).toBe('outcome');
        expect((error as Error).message).toContain('outcome must be');
      }
    }
  });
});

describe('validateWagerAmount (#1439)', () => {
  it('accepts positive integers as number, bigint, or decimal string', () => {
    expect(MIN_WAGER_STROOPS).toBe(1n);
    expect(validateWagerAmount(1)).toBe(1n);
    expect(validateWagerAmount(2_500_000)).toBe(2_500_000n);
    expect(validateWagerAmount(10n)).toBe(10n);
    expect(validateWagerAmount(' 12345 ')).toBe(12345n);
    expect(validateWagerAmount(MAX_WAGER_STROOPS)).toBe(MAX_WAGER_STROOPS);
  });

  it('fails fast on zero or negative amounts', () => {
    for (const invalid of [0, -5, 0n, '-3']) {
      expect(() => validateWagerAmount(invalid)).toThrow(
        /amountStroops must be greater than zero|amountStroops must be a positive integer/
      );
    }
  });

  it('fails fast on non-integer values', () => {
    for (const invalid of [1.5, '12.5', 'abc', '', null, undefined, {}, Number.NaN]) {
      expect(() => validateWagerAmount(invalid)).toThrow(WagerValidationError);
    }
    try {
      validateWagerAmount(1.5);
    } catch (error) {
      expect((error as WagerValidationError).field).toBe('amountStroops');
      expect((error as Error).message).toContain('positive integer');
    }
  });

  it('rejects amounts above the contract i128 range', () => {
    expect(() => validateWagerAmount(MAX_WAGER_STROOPS + 1n)).toThrow(
      /must not exceed/
    );
  });
});

describe('validatePoolId (#1439)', () => {
  it('accepts positive u32 ids', () => {
    expect(validatePoolId(1)).toBe(1);
    expect(validatePoolId(0xffff_ffff)).toBe(0xffff_ffff);
  });

  it('rejects non-u32 ids', () => {
    for (const invalid of [0, -1, 1.5, 0x1_0000_0000, '7', null]) {
      expect(() => validatePoolId(invalid)).toThrow(WagerValidationError);
    }
  });
});

describe('validateReferrer (#1439)', () => {
  it('normalizes absent referrers to null', () => {
    expect(validateReferrer(undefined, WALLET_ADDRESS)).toBeNull();
    expect(validateReferrer(null, WALLET_ADDRESS)).toBeNull();
    expect(validateReferrer('', WALLET_ADDRESS)).toBeNull();
  });

  it('accepts a valid distinct account id', () => {
    expect(validateReferrer(REFERRER, WALLET_ADDRESS)).toBe(REFERRER);
  });

  it('rejects malformed referrers and self-referrals', () => {
    expect(() => validateReferrer('not-an-address', WALLET_ADDRESS)).toThrow(
      /Stellar account id/
    );
    expect(() => validateReferrer(WALLET_ADDRESS, WALLET_ADDRESS)).toThrow(
      /must differ from the wager address/
    );
  });
});

describe('normalizePlaceWagerParams (#1439)', () => {
  it('requires a connected wallet', () => {
    expect(() =>
      normalizePlaceWagerParams({
        wallet: { address: '' } as unknown as FreighterWalletClient,
        poolId: 1,
        outcome: 'A',
        amountStroops: 1,
      })
    ).toThrow(WagerValidationError);

    try {
      normalizePlaceWagerParams({
        wallet: undefined as unknown as FreighterWalletClient,
        poolId: 1,
        outcome: 'A',
        amountStroops: 1,
      });
    } catch (error) {
      expect((error as WagerValidationError).field).toBe('wallet');
    }
  });

  it('reports the first invalid field with its clear message', () => {
    try {
      normalizePlaceWagerParams({
        wallet: wallet(),
        poolId: 3,
        outcome: 'C',
        amountStroops: 100,
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WagerValidationError);
      expect((error as WagerValidationError).field).toBe('outcome');
      expect((error as Error).message).toContain('got "C"');
    }
  });
});

describe('placeWager (#1439)', () => {
  it('submits encoded arguments and returns a structured result', async () => {
    const submit = vi.fn(async () => ({ txHash: 'abc123hash' }));

    const result = await placeWager(
      {
        wallet: wallet(),
        poolId: 12,
        outcome: 'B',
        amountStroops: '2500000',
        referrer: REFERRER,
      },
      { submit }
    );

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      wallet: expect.objectContaining({ address: WALLET_ADDRESS }),
      poolId: 12,
      outcome: 1,
      amountStroops: 2_500_000n,
      referrer: REFERRER,
      onStageChange: undefined,
      onFeeEstimated: undefined,
    });
    expect(result).toEqual({
      status: 'SUCCESS',
      txHash: 'abc123hash',
      poolId: 12,
      outcome: 1,
      outcomeLabel: 'B',
      amountStroops: '2500000',
      referrer: REFERRER,
      submittedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(result.submittedAt))).toBe(false);
  });

  it('forwards stage and fee callbacks to the submitter', async () => {
    const onStageChange = vi.fn();
    const onFeeEstimated = vi.fn(async () => true);
    const submit = vi.fn(async () => ({ txHash: 'hash' }));

    await placeWager(
      {
        wallet: wallet(),
        poolId: 1,
        outcome: 0,
        amountStroops: 1_000,
        onStageChange,
        onFeeEstimated,
      },
      { submit }
    );

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ onStageChange, onFeeEstimated })
    );
  });

  it('fails fast without contacting the submitter when input is invalid', async () => {
    const submit = vi.fn(async () => ({ txHash: 'unused' }));
    const base = {
      wallet: wallet(),
      poolId: 1,
      outcome: 'A' as const,
      amountStroops: 1_000,
    };

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, poolId: 0 }, 'poolId'],
      [{ ...base, outcome: 'C' }, 'outcome'],
      [{ ...base, amountStroops: 0 }, 'amountStroops'],
      [{ ...base, amountStroops: 2.5 }, 'amountStroops'],
      [{ ...base, amountStroops: 'abc' }, 'amountStroops'],
      [{ ...base, amountStroops: MAX_WAGER_STROOPS + 1n }, 'amountStroops'],
      [{ ...base, referrer: 'bad' }, 'referrer'],
      [{ ...base, referrer: WALLET_ADDRESS }, 'referrer'],
    ];

    for (const [params, field] of cases) {
      await expect(
        placeWager(params as never, { submit })
      ).rejects.toBeInstanceOf(WagerValidationError);
      try {
        await placeWager(params as never, { submit });
      } catch (error) {
        expect((error as WagerValidationError).field).toBe(field);
      }
    }

    expect(submit).not.toHaveBeenCalled();
  });

  it('propagates submission failures unchanged', async () => {
    const submit = vi.fn(async () => {
      throw new Error('Simulation failed: HostError: Error(Contract, #4)');
    });

    await expect(
      placeWager(
        { wallet: wallet(), poolId: 2, outcome: 'A', amountStroops: 10 },
        { submit }
      )
    ).rejects.toThrow('Simulation failed: HostError: Error(Contract, #4)');
  });

  it('rejects a submission that did not return a transaction hash', async () => {
    const submit = vi.fn(async () => ({ txHash: '' }));

    await expect(
      placeWager(
        { wallet: wallet(), poolId: 2, outcome: 'A', amountStroops: 10 },
        { submit }
      )
    ).rejects.toThrow('place_wager submission did not return a transaction hash');
  });

  it('uses the wallet adapter by default and surfaces its tx hash', async () => {
    const placeBet = vi
      .spyOn(SorobanTransactionService.prototype, 'placeBet')
      .mockResolvedValue({ status: 'SUCCESS', txHash: 'adapter-tx' });

    const result = await placeWager({
      wallet: wallet(),
      poolId: 5,
      outcome: 'A',
      amountStroops: 4_200,
    });

    expect(result.txHash).toBe('adapter-tx');
    expect(placeBet).toHaveBeenCalledWith(
      expect.objectContaining({ address: WALLET_ADDRESS }),
      CONTRACT_ID,
      expect.objectContaining({
        poolId: 5,
        outcome: 0,
        amountStroops: 4_200n,
        referrer: null,
      }),
      undefined,
      undefined
    );
  });
});

describe('place_wager transaction assembly (#1439)', () => {
  function serviceWithCapturedTransaction(): {
    service: SorobanTransactionService;
    captured: () => Transaction;
  } {
    const service = new SorobanTransactionService(
      'https://soroban-testnet.stellar.org',
      'testnet'
    );
    const internals = service as unknown as {
      server: { getAccount: (address: string) => Promise<Account> };
      executeWithFeePrompt: (tx: Transaction) => Promise<{
        status: 'SUCCESS';
        txHash: string;
      }>;
    };

    internals.server = {
      getAccount: async (address: string) => new Account(address, '1'),
    };
    let built: Transaction | undefined;
    internals.executeWithFeePrompt = async (tx: Transaction) => {
      built = tx;
      return { status: 'SUCCESS', txHash: 'deadbeef' };
    };

    return {
      service,
      captured: () => {
        if (!built) throw new Error('transaction was not built');
        return built;
      },
    };
  }

  function submitThrough(service: SorobanTransactionService): PlaceBetSubmitter {
    return async (submission) => {
      const result = await service.placeBet(
        submission.wallet,
        CONTRACT_ID,
        {
          poolId: submission.poolId,
          outcome: submission.outcome,
          amountStroops: submission.amountStroops,
          referrer: submission.referrer,
        },
        submission.onStageChange,
        submission.onFeeEstimated
      );
      return { txHash: result.txHash };
    };
  }

  it('encodes (user, pool_id, outcome, amount, referrer) as the contract expects', async () => {
    const { service, captured } = serviceWithCapturedTransaction();

    const result = await placeWager(
      {
        wallet: wallet(),
        poolId: 7,
        outcome: 'A',
        amountStroops: 1_500n,
      },
      { submit: submitThrough(service) }
    );

    expect(result.txHash).toBe('deadbeef');

    const operation = captured().operations[0] as unknown as {
      func: { invokeContract: () => { args: () => xdr.ScVal[] } };
    };
    const args = operation.func.invokeContract().args();

    expect(args).toHaveLength(5);
    expect(scValToNative(args[0])).toBe(WALLET_ADDRESS);
    expect(scValToNative(args[1])).toBe(7);
    expect(scValToNative(args[2])).toBe(0);
    expect(scValToNative(args[3])).toBe(1_500n);
    // No referrer → Option<Address>::None encoded as ScVal void.
    expect(args[4].switch()).toBe(xdr.ScValType.scvVoid());
  });

  it('encodes a supplied referrer as an Address ScVal', async () => {
    const { service, captured } = serviceWithCapturedTransaction();

    await placeWager(
      {
        wallet: wallet(),
        poolId: 8,
        outcome: 'b',
        amountStroops: 99,
        referrer: REFERRER,
      },
      { submit: submitThrough(service) }
    );

    const operation = captured().operations[0] as unknown as {
      func: { invokeContract: () => { args: () => xdr.ScVal[] } };
    };
    const args = operation.func.invokeContract().args();

    expect(scValToNative(args[1])).toBe(8);
    expect(scValToNative(args[2])).toBe(1);
    expect(scValToNative(args[3])).toBe(99n);
    expect(scValToNative(args[4])).toBe(REFERRER);
  });
});
