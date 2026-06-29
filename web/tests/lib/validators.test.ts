import { describe, it, expect } from 'vitest';
import {
  validateContractId,
  validatePoolDescription,
  validatePoolTitle,
  validateOutcome,
  validateDuration,
  validateStellarAddress,
  validateStellarContractAddress,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_OUTCOME_LENGTH,
  MIN_POOL_DURATION_SECS,
  MAX_POOL_DURATION_SECS,
} from '../../lib/validators';

describe('validateContractId', () => {
  it('accepts a valid mainnet contract identifier', () => {
    const result = validateContractId(
      'SPENV2J0V4BHRFAZ6FVF97K9ZGQJ0GT19RC3JFN7.predinex-pool',
      'mainnet'
    );
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts a valid testnet contract identifier', () => {
    const result = validateContractId(
      'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
      'testnet'
    );
    expect(result.valid).toBe(true);
  });

  it('rejects missing separators', () => {
    const result = validateContractId('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/format/i);
  });

  it('rejects a network/address mismatch', () => {
    const result = validateContractId(
      'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
      'mainnet'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/mainnet/i);
  });
});

describe('validateStellarAddress', () => {
  describe('valid addresses', () => {
    it('accepts a valid G-prefixed public key', () => {
      const result = validateStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts a valid C-prefixed contract address', () => {
      const result = validateStellarAddress('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts another valid G-prefixed address', () => {
      const result = validateStellarAddress('GD5DJQBRKECZEZMTYX6V5EHFNMKZ5YGL4ZMYZ2E5XNHYASZQ4EIG4R2B');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('missing or empty input', () => {
    it('rejects an empty string', () => {
      const result = validateStellarAddress('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    });

    it('rejects a null input', () => {
      const result = validateStellarAddress(null as never);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    });

    it('rejects an undefined input', () => {
      const result = validateStellarAddress(undefined as never);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    });
  });

  describe('invalid formats', () => {
    it('rejects addresses with wrong prefix', () => {
      const result = validateStellarAddress('SA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*format/i);
    });

    it('rejects addresses that are too short', () => {
      const result = validateStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*format/i);
    });

    it('rejects addresses that are too long', () => {
      const result = validateStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZZ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*format/i);
    });

    it('rejects addresses with invalid characters', () => {
      const result = validateStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSG0');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*format/i);
    });

    it('rejects lowercase addresses', () => {
      const result = validateStellarAddress('ga7qynf7sowq3glr2bgmzehxavirza4kvwltjjfc7mgxua74p7ujvsgz');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*format/i);
    });
  });
});

describe('validateStellarContractAddress', () => {
  describe('valid contract addresses', () => {
    it('accepts a valid C-prefixed contract address', () => {
      const result = validateStellarContractAddress('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts another valid C-prefixed contract address', () => {
      const result = validateStellarContractAddress('CCV2F3HHPJ5KQWZIQYBXLF3D5XDY4D5MHKXZ4FFLFKSKNIOGOHYRFTMP');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('missing or empty input', () => {
    it('rejects an empty string', () => {
      const result = validateStellarContractAddress('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    });

    it('rejects a whitespace-only string', () => {
      const result = validateStellarContractAddress('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    });
  });

  describe('invalid contract addresses', () => {
    it('rejects G-prefixed public keys', () => {
      const result = validateStellarContractAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*contract.*address/i);
    });

    it('rejects addresses that are too short', () => {
      const result = validateStellarContractAddress('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*contract.*address/i);
    });

    it('rejects addresses with wrong prefix', () => {
      const result = validateStellarContractAddress('BA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*contract.*address/i);
    });

    it('rejects addresses with invalid characters', () => {
      const result = validateStellarContractAddress('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSG0');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*contract.*address/i);
    });
  });
});

describe('validateDuration (issue #151)', () => {
  it('exposes the contract minimum as 300 seconds', () => {
    expect(MIN_POOL_DURATION_SECS).toBe(300);
  });

  it('rejects 0 with a "greater than 0" error', () => {
    const result = validateDuration(0);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it('rejects a negative duration', () => {
    const result = validateDuration(-1);
    expect(result.valid).toBe(false);
  });

  it('rejects a duration just below the contract minimum', () => {
    const result = validateDuration(MIN_POOL_DURATION_SECS - 1);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 300 seconds/i);
  });

  it('accepts a duration exactly at the contract minimum', () => {
    const result = validateDuration(MIN_POOL_DURATION_SECS);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts a typical duration well above the minimum', () => {
    const result = validateDuration(3600);
    expect(result.valid).toBe(true);
  });

  it('rejects a duration above the soft upper bound', () => {
    const result = validateDuration(MAX_POOL_DURATION_SECS + 1);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/less than/i);
  });

  it('accepts a duration exactly at the upper bound', () => {
    const result = validateDuration(MAX_POOL_DURATION_SECS);
    expect(result.valid).toBe(true);
  });
});

describe('metadata length validation (issue #154)', () => {
  it('rejects title above contract max length', () => {
    const result = validatePoolTitle('T'.repeat(MAX_TITLE_LENGTH + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/100.*fewer/i);
  });

  it('rejects description above contract max length', () => {
    const result = validatePoolDescription('D'.repeat(MAX_DESCRIPTION_LENGTH + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/1000.*fewer/i);
  });

  it('rejects outcome above contract max length', () => {
    const result = validateOutcome('A'.repeat(MAX_OUTCOME_LENGTH + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/50.*fewer/i);
  });
});
