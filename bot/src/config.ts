/**
 * Bot configuration loaded from environment variables.
 *
 * All required variables are validated at startup. The process exits
 * immediately with a descriptive error if any required variable is missing
 * or malformed.
 */

import { Keypair, Networks } from "@stellar/stellar-sdk";
import "dotenv/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface BotConfig {
  // Network
  rpcUrl: string;
  networkPassphrase: string;
  network: "testnet" | "mainnet";
  /**
   * Whether the Soroban RPC client may connect over plain HTTP.
   * Defaults to false unless rpcUrl itself is an http:// URL (e.g. a local
   * standalone node), or ALLOW_HTTP is explicitly set.
   */
  allowHttp: boolean;

  // Contract
  contractId: string;

  // Bot wallet
  botSecretKey: string;
  botPublicKey: string;

  // Polling
  pollIntervalMs: number;
  batchSize: number;

  /** Max pools per settle_pools transaction (1-–50). */
  settleBatchSize: number;

  // Settlement
  dryRun: boolean;
  autoSettleEnabled: boolean;
  defaultWinningOutcome: number;

  // Incentives
  /** Volume bonus percentage (0–100) applied to calculateVolumeBonus. */
  volumeBonusPercent: number;

  // Oracle resolution
  /** Base URL of the external resolution oracle (e.g. https://oracle.example.com). Null = disabled. */
  oracleUrl: string | null;
  /** Bearer token sent as Authorization header to the oracle. Null = no auth. */
  oracleSecret: string | null;
  /**
   * When true, pools whose outcome could not be resolved by the oracle or
   * on-chain data fall back to defaultWinningOutcome.
   * When false (the default), unresolvable pools are skipped — more safe for production.
   */
  oracleFallbackToDefault: boolean;

  // Transaction polling
  txPollIntervalMs: number;
  txPollMaxAttempts: number;

  // Retry
  maxRetries: number;
  retryBaseDelayMs: number;

  // Notifications
  webhookUrl: string | null;
  webhookSecret: string | null;
  /** Timeout in milliseconds for a single webhook delivery attempt. */
  webhookTimeoutMs: number;

  // Logging
  logLevel: LogLevel;

  // Health check
  healthCheckEnabled: boolean;
  healthCheckPort: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.error(`[config] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

function optionalEnv(name: string, fallback: string): string {
  return (process.env[name] ?? fallback).trim();
}

function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    console.error(
      `[config] Environment variable ${name}="${value}" must be a positive integer`,
    );
    process.exit(1);
  }
  return n;
}

function parseSettleBatchSize(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 50) {
    console.error(
      `[config] SettLEBATCH_SIZE="${value}" must be an integer between 1 and 50`,
    );
    process.exit(1);
  }
  return n;
}

function parseLogLevel(value: string): LogLevel {
  if (["debug", "info", "warn", "error"].includes(value)) {
    return value as LogLevel;
  }
  console.warn(`[config] Unknown LOG_LEVEl="${value}", defaulting to "info"`);
  return "info";
}

function validateContractId(id: string): void {
  if (!id.startsWith("C") || id.length !== 56) {
    console.error(
      `[config] CONTRACT_ID="${id}" does not look like a valid Stellar contract strkey (should start with 'C' and be 56 chars)`,
    );
    process.exit(1);
  }
  // Valid Stellar base32: A-Z, 2-7
  if (!/^[C][A-Z2-7]{55}$/.test(id)) {
    console.error(
      `[config] CONTRACT_ID="${id}" contains invalid base32 characters (must be A-Z, 2-7)`,
    );
    process.exit(1);
  }
}

export function deriveBotPublicKey(secretKey: string): string {
  try {
    return Keypair.fromSecret(secretKey).publicKey();
  } catch {
    return "G" + "A".repeat(55);
  }
}

function validateSecretKey(key: string): void {
  if (!key.startsWith("S") || key.length !== 56) {
    console.error(
      `[config] BOT_SECRET_KEY does not look like a valid Stellar secret key (should start with 'S' and be 56 chars)`,
    );
    process.exit(1);
  }
}

export function loadConfig(): BotConfig {
  const rpcUrl = requireEnv("STELLAR_RPC_URL");
  const rawNetwork = optionalEnv("STELLAR_NETWORK", "testnet").toLowerCase();
  if (rawNetwork !== "testnet" && rawNetwork !== "mainnet") {
    console.error(
      `[config] STELLAR_NETWORK must be "testnet" or "mainnet", got "${rawNetwork}"`,
    );
    process.exit(1);
  }
  const network = rawNetwork as "testnet" | "mainnet";
  const networkPassphrase =
    network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

  const allowHttpEnv = process.env["ALLOW_HTTP"];
  const allowHttp =
    allowHttpEnv !== undefined
      ? allowHttpEnv.trim().toLowerCase() === "true"
      : rpcUrl.startsWith("http://");

  const contractId = requireEnv("CONTRACT_ID");
  validateContractId(contractId);

  const botSecretKey = requireEnv("BOT_SECRET_KEY");
  validateSecretKey(botSecretKey);
  const botPublicKey = deriveBotPublicKey(botSecretKey);

  const pollIntervalMs = parsePositiveInt(
    optionalEnv("POLL_INTERVAL_MS", "300000"),
    "POLL_INTERVAL_MS",
  );
  const batchSize = parsePositiveInt(
    optionalEnv("BATCH_SIZE", "100"),
    "BATCH_SIZE",
  );
  if (batchSize > 100) {
    console.warn(
      `[config] BATCH_SIZE=${batchSize} exceeds contract maximum of 100, clamping to 100`,
    );
  }

  const settleBatchSize = parseSettleBatchSize(
    optionalEnv("SETTLE_BATCH_SIZE", "20"),
  );

  const dryRun = optionalEnv("DRY_RUN", "false").toLowerCase() === "true";
  const autoSettleEnabled =
    optionalEnv("AUTO_SETTLE_ENABLED", "false").toLowerCase() === "true";
  const defaultWinningOutcome = parseInt(
    optionalEnv("DEFAULT_WINNING_OUTCOME", "0"),
    10,
  );
  if (isNaN(defaultWinningOutcome) || defaultWinningOutcome < 0) {
    console.error(
      `[config] DEFAULT_WINNING_OUTCOME must be a non-negative integer`,
    );
    process.exit(1);
  }

  // Volume bonus percentage: non-negative integer between 0 and 100
  const volumeBonusPercent = parseInt(
    optionalEnv("VOLUME_BONUS_PERCENT", "2"),
    10,
  );
  if (
    isNaN(volumeBonusPercent) ||
    volumeBonusPercent < 0 ||
    volumeBonusPercent > 100
  ) {
    console.error(
      `[config] VOLUME_BONUS_PERCENT must be an integer between 0 and 100`,
    );
    process.exit(1);
  }

  const oracleUrl = process.env["ORACLE_URL"]?.trim() || null;
  const oracleSecret = process.env["ORACLE_SECRET"]?.trim() || null;
  const oracleFallbackToDefault =
    optionalEnv("ORACLE_FALLBACK_TO_DEFAULT", "false").toLowerCase() ===
    "true";

  const txPollIntervalMs = parsePositiveInt(
    optionalEnv("TX_POLL_INTERVAL_MS", "3000"),
    "TX_POLL_INTERVAL_MS",
  );
  const txPollMaxAttempts = parsePositiveInt(
    optionalEnv("TX_POLL_MAX_ATTEMPTS", "30"),
    "TX_POLL_MAX_ATTEMPTS",
  );

  const maxRetries = parsePositiveInt(
    optionalEnv("MAX_RETRIES", "3"),
    "MAX_RETRIES",
  );
  const retryBaseDelayMs = parsePositiveInt(
    optionalEnv("RETRY_BASE_DELAY_MS", "1000"),
    "RETRY_BASE_DELAY_MS",
  );

  const webhookUrl = process.env["WEBHOOK_URL"]?.trim() || null;
  if (webhookUrl !== null) {
    try {
      new URL(webhookUrl);
    } catch {
      console.error(`[config] WEBHOOK_URL="${webhookUrl}" is not a valid URL`);
      process.exit(1);
    }
  }

  const webhookSecret = process.env["WEBHOOK_SECRET"]?.trim() || null;
  if (webhookSecret !== null && webhookSecret.length < 16) {
    console.error(`[config] WEBHOOK_SECRET must be at least 16 characters long`);
    process.exit(1);
  }
  const webhookTimeoutMs = parsePositiveInt(
    optionalEnv("WEBHOOK_TIMEOUT_MS", "10000"),
    "WEBHOOK_TIMEOUT_MS",
  );
  const logLevel = parseLogLevel(optionalEnv("LOG_LEVEL", "info"));

  const healthCheckEnabled =
    optionalEnv("HEALTH_CHECK_ENABLED", "true").toLowerCase() === "true";
  const healthCheckPort = parsePositiveInt(
    optionalEnv("HEALTH_CHECK_PORT", "3000"),
    "HEALTH_CHECK_PORT",
  );

  return {
    rpcUrl,
    networkPassphrase,
    network,
    allowHttp,
    contractId,
    botSecretKey,
    botPublicKey,
    pollIntervalMs,
    batchSize: Math.min(batchSize, 100),
    settleBatchSize,
    dryRun,
    autoSettleEnabled,
    defaultWinningOutcome,
    volumeBonusPercent,
    oracleUrl,
    oracleSecret,
    oracleFallbackToDefault,
    txPollIntervalMs,
    txPollMaxAttempts,
    maxRetries,
    retryBaseDelayMs,
    webhookUrl,
    webhookSecret,
    webhookTimeoutMs,
    logLevel,
    healthCheckEnabled,
    healthCheckPort,
  };
}
