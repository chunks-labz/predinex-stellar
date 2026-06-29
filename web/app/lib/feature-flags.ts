export const ORACLE_MANAGEMENT_PLACEHOLDER_FLAG =
  'NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER';

export const DISPUTE_MOCK_DATA_FLAG = 'NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA';

type NodeEnv = Record<string, string | undefined>;
function readOracleManagementPlaceholderFlag(): string | undefined {
  const env = ((globalThis as { process?: { env?: NodeEnv } }).process?.env) ?? {};
  return env.NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER;
}

function readDisputeMockDataFlag(): string | undefined {
  const env = ((globalThis as { process?: { env?: NodeEnv } }).process?.env) ?? {};
  return env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA;
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function isOracleManagementPlaceholderEnabled(): boolean {
  return isExplicitlyEnabled(readOracleManagementPlaceholderFlag());
}

export function isDisputeMockDataEnabled(): boolean {
  return isExplicitlyEnabled(readDisputeMockDataFlag());
}
