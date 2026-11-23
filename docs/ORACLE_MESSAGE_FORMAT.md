# Oracle message format

This document defines the signed message exchanged between an oracle reporter and
the Predinex settlement flow. The same canonical bytes must be used for signing,
verification, replay protection, and audit logging.

## Canonical payload

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `domain` | string | yes | `predinex/oracle` |
| `version` | string | yes | Protocol version, currently `v1` |
| `network` | string | yes | `testnet` or `pubnet` |
| `contract_id` | string | yes | Target Soroban contract |
| `pool_id` | unsigned integer | yes | Market being resolved |
| `winning_outcome` | unsigned integer | yes | Outcome selected by the oracle |
| `observed_at` | RFC 3339 string | yes | Time the oracle observed the result |
| `nonce` | string | yes | Unique value used once per pool |
| `expires_at` | RFC 3339 string | yes | Verification deadline |
| `reporter` | string | yes | Stellar G-address of the reporter |

Example:

~~~json
{
  "domain": "predinex/oracle",
  "version": "v1",
  "network": "testnet",
  "contract_id": "C....",
  "pool_id": 42,
  "winning_outcome": 1,
  "observed_at": "2026-11-23T12:00:00Z",
  "nonce": "01HF…",
  "expires_at": "2026-11-23T12:10:00Z",
  "reporter": "G...."
}
~~~

## Signing and verification

1. Serialize as UTF-8 JSON with stable key ordering and the exact field names above.
2. Prefix the bytes with `predinex/oracle/v1\n`.
3. Sign the resulting bytes with the reporter's Stellar Ed25519 key.
4. Submit the payload, base64 signature, and reporter address.
5. Verify domain, network, contract, expiry, nonce uniqueness, reporter
   authorization, and signature before calling `settle_pool`.

A signature is not a substitute for authorization: the contract still enforces
its on-chain reporter/admin rules. Reject unknown versions instead of silently
interpreting them as v1.

## Replay and failure handling

- Store the nonce keyed by `(contract_id, pool_id, nonce)` before settlement.
- Reject expired messages and timestamps outside the configured clock-skew window.
- Never log private keys or the complete signed message. Log only pool id,
  reporter, version, and a hash of the canonical bytes.
- Rotate keys through the [oracle rotation runbook](./ORACLE_ROTATION.md).
