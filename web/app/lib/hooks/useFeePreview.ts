/**
 * useFeePreview — derives market-creation fee breakdown from form inputs.
 *
 * ⚠️  PLACEHOLDER VALUES — not derived from actual contract or network fees.
 * These will be replaced with real values from the contract and network once deployed.
 *
 * Current behavior:
 * Protocol fee: hardcoded 50 STX (placeholder).
 * Network fee:  estimated from transaction byte-size proxy (title + description length).
 *               Base 0.001 STX + 0.000001 STX per character of user-supplied text (placeholder).
 *
 * Both values are stable constants / simple math — no async fetch needed.
 */

export interface FeePreview {
  /** Fixed protocol fee in STX */
  protocolFee: number;
  /** Estimated network (miner) fee in STX */
  networkFee: number;
  /** Total estimated cost in STX */
  total: number;
}

/** Fixed protocol fee charged by the contract (in STX). ⚠️  PLACEHOLDER — replace with actual contract fee. */
export const PROTOCOL_FEE_STX = 50;

/** Base network fee in STX (≈ 1 000 µSTX). ⚠️  PLACEHOLDER — replace with actual network fee. */
const BASE_NETWORK_FEE_STX = 0.001;

/** Per-character fee increment in STX (≈ 1 µSTX / char). ⚠️  PLACEHOLDER — replace with actual fee model. */
const PER_CHAR_FEE_STX = 0.000001;

/**
 * Computes a fee preview for the create-market form.
 *
 * @param title       Market question / title
 * @param description Market description
 * @returns           Broken-down fee estimate
 */
export function useFeePreview(title: string, description: string): FeePreview {
  const charCount = title.length + description.length;
  const networkFee = parseFloat(
    (BASE_NETWORK_FEE_STX + charCount * PER_CHAR_FEE_STX).toFixed(6)
  );
  const protocolFee = PROTOCOL_FEE_STX;
  const total = parseFloat((protocolFee + networkFee).toFixed(6));
  return { protocolFee, networkFee, total };
}
