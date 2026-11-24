// Track signed transactions as submission starts. Keep the submission time
// across retries so a missing RPC result cannot keep a record alive forever.
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
type Network = 'mainnet' | 'testnet';
type Pending = { hash: string; submittedAt: number };

function key(network: Network) {
  return `predinex_pending_transactions_${network}`;
}

export function readPending(network: Network, now = Date.now()): Pending[] {
  try {
    const raw = sessionStorage.getItem(key(network));
    if (!raw) return [];
    const entries: Pending[] = JSON.parse(raw);
    const valid = entries.filter(entry => entry && /^[a-f0-9]{64}$/i.test(entry.hash) &&
      Number.isFinite(entry.submittedAt) && entry.submittedAt <= now && now - entry.submittedAt < PENDING_TTL_MS);
    if (valid.length !== entries.length) sessionStorage.setItem(key(network), JSON.stringify(valid));
    return valid;
  } catch {
    return [];
  }
}

export function trackPending(network: Network, hash: string) {
  try {
    const pending = readPending(network);
    if (!pending.some(entry => entry.hash === hash)) {
      pending.push({ hash, submittedAt: Date.now() });
      sessionStorage.setItem(key(network), JSON.stringify(pending));
    }
  } catch { /* Wallet submission still works without browser storage. */ }
}

export function clearPending(network: Network, hash: string) {
  try {
    const remaining = readPending(network).filter(entry => entry.hash !== hash);
    sessionStorage.setItem(key(network), JSON.stringify(remaining));
  } catch { /* Storage may be disabled. */ }
}
