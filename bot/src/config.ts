/**
 * Bot configuration loaded from environment variables.
 *
 * All required variables are validated at startup. The process exits
 * immediately with a descriptive error if any required variable is missing
 * or malformed.
 */

import { Networks } from "@stellar/stellar-sdk";
import "dotenv/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface BotConfig {
  // Network
  rpcUrl: string;
  networkPassphrase: string;
  network: "testnet" | "mainnet";

  // Contract
  contractId: string;

  // Bot wallet
  botSecretKey: string;

  // Polling
  pollIntervalMs: number;
  batchSize: number;

  // Settlement
  dryRun: boolean;
  autoSettleEnabled: boolean;
  defaultWinningOutcome: number;

  // Retry
  maxRetries: number;
  retryBaseDelayMs: number;

  // Notifications
  webhookUrl: string | null;
  webhookSecret: string | null;

  // Logging
  logLevel: LogLevel;
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

function parseLogLevel(value: string): LogLevel {
  if (["debug", "info", "warn", "error"].includes(value)) {
    return value as LogLevel;
  }
  console.warn(`[config] Unknown LOG_LEVEL="${value}", defaulting to "info"`);
  return "info";
}

function validateContractId(id: string): void {
  if (!id.startsWith("C") || id.length !== 56) {
    console.error(
      `[config] CONTRACT_ID="${id}" does not look like a valid Stellar contract strkey (should start with 'C' and be 56 chars)`,
    );
    process.exit(1);
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

  const contractId = requireEnv("CONTRACT_ID");
  validateContractId(contractId);

  const botSecretKey = requireEnv("BOT_SECRET_KEY");
  validateSecretKey(botSecretKey);

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

  const maxRetries = parsePositiveInt(
    optionalEnv("MAX_RETRIES", "3"),
    "MAX_RETRIES",
  );
  const retryBaseDelayMs = parsePositiveInt(
    optionalEnv("RETRY_BASE_DELAY_MS", "1000"),
    "RETRY_BASE_DELAY_MS",
  );

  const webhookUrl = process.env["WEBHOOK_URL"]?.trim() || null;
  const webhookSecret = process.env["WEBHOOK_SECRET"]?.trim() || null;
  const logLevel = parseLogLevel(optionalEnv("LOG_LEVEL", "info"));

  return {
    rpcUrl,
    networkPassphrase,
    network,
    contractId,
    botSecretKey,
    pollIntervalMs,
    batchSize: Math.min(batchSize, 100),
    dryRun,
    autoSettleEnabled,
    defaultWinningOutcome,
    maxRetries,
    retryBaseDelayMs,
    webhookUrl,
    webhookSecret,
    logLevel,
  };
}
