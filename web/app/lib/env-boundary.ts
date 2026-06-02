export const CLIENT_SAFE_RUNTIME_ENV_KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_APP_VERSION',
  'NEXT_PUBLIC_CONTRACT_ADDRESS',
  'NEXT_PUBLIC_CONTRACT_NAME',
  'NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER',
  'NEXT_PUBLIC_NETWORK',
  'NEXT_PUBLIC_NETWORK_TYPE',
  'NEXT_PUBLIC_SOROBAN_CONTRACT_ID',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_TOKEN_NAME',
  'NEXT_PUBLIC_TOKEN_SYMBOL',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'NEXT_PUBLIC_WEBHOOK_ENABLED',
  'NEXT_PUBLIC_WEBHOOK_SECRET',
  'NEXT_PUBLIC_WEBHOOK_URL',
] as const;

export const CLIENT_BUILD_SYSTEM_ENV_KEYS = ['NODE_ENV', 'CI'] as const;

export const CLIENT_ALLOWED_ENV_KEYS = [
  ...CLIENT_SAFE_RUNTIME_ENV_KEYS,
  ...CLIENT_BUILD_SYSTEM_ENV_KEYS,
] as const;

const CLIENT_ALLOWED_ENV_KEY_SET = new Set<string>(CLIENT_ALLOWED_ENV_KEYS);

export function assertClientEnvAccessIsSafe(keys: Iterable<string>): void {
  const disallowed = [...new Set(keys)].filter((key) => !CLIENT_ALLOWED_ENV_KEY_SET.has(key)).sort();
  if (disallowed.length > 0) {
    throw new Error(
      `Disallowed client env access detected: ${disallowed.join(
        ', '
      )}. Only documented NEXT_PUBLIC_* runtime values and build-time NODE_ENV/CI are allowed.`
    );
  }
}
