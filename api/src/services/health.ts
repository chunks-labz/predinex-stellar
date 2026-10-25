export type DependencyName = 'database' | 'rpc' | 'queue';

export interface DependencyHealth {
  status: 'healthy' | 'degraded';
  latencyMs?: number;
  detail?: string;
}

export interface HealthReport {
  status: 'healthy' | 'degraded';
  dependencies: Record<DependencyName, DependencyHealth>;
  cachedAt: string;
}

type Probe = () => Promise<DependencyHealth>;

const DEFAULT_CACHE_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 1_000;
let cached: { expiresAt: number; report: HealthReport } | undefined;
let inFlight: Promise<HealthReport> | undefined;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function dependencyUrl(name: DependencyName): string | undefined {
  const key = `${name.toUpperCase()}_URL`;
  return process.env[`HEALTH_${key}`] || process.env[key];
}

async function probeUrl(name: DependencyName): Promise<DependencyHealth> {
  const url = dependencyUrl(name);
  if (!url) return { status: 'healthy', detail: 'not configured' };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    positiveInt(process.env.HEALTH_PROBE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  );
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return {
      status: response.ok ? 'healthy' : 'degraded',
      latencyMs: Date.now() - started,
      detail: response.ok ? undefined : `${name} returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: 'degraded',
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : `${name} probe failed`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const probes: Record<DependencyName, Probe> = {
  database: () => probeUrl('database'),
  rpc: () => probeUrl('rpc'),
  queue: () => probeUrl('queue'),
};

export async function getHealthReport(now = Date.now()): Promise<HealthReport> {
  if (cached && now < cached.expiresAt) return cached.report;
  if (inFlight) return inFlight;

  inFlight = Promise.all(
    (Object.keys(probes) as DependencyName[]).map(async (name) => [name, await probes[name]()] as const)
  ).then((entries) => {
    const dependencies = Object.fromEntries(entries) as Record<DependencyName, DependencyHealth>;
    const report: HealthReport = {
      status: Object.values(dependencies).every((dependency) => dependency.status === 'healthy')
        ? 'healthy'
        : 'degraded',
      dependencies,
      cachedAt: new Date().toISOString(),
    };
    cached = {
      report,
      expiresAt: Date.now() + positiveInt(process.env.HEALTH_CACHE_MS, DEFAULT_CACHE_MS),
    };
    return report;
  }).finally(() => {
    inFlight = undefined;
  });

  return inFlight;
}

export function resetHealthCache(): void {
  cached = undefined;
  inFlight = undefined;
}
