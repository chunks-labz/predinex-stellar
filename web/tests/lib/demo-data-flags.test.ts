/**
 * Demo-data flag guard tests (#1306).
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so a
 * demo-data flag is a property of the built artifact rather than a runtime
 * toggle. These tests pin the guard that refuses such flags in a production
 * build, and the fact that the refusal is logged rather than silent.
 *
 * Imports `feature-flags` directly rather than `adapters/activity`: the latter
 * has a pre-existing broken dynamic import (`../hooks/usePoolActivity`, which
 * resolves to `app/lib/hooks/`) that fails collection on `main` independently of
 * this change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACTIVITY_FIXTURES_FLAG,
  DISPUTE_MOCK_DATA_FLAG,
  areActivityFixturesEnabled,
  isDemoDataFlagEnabled,
  isDisputeMockDataEnabled,
  isProductionBuild,
} from '../../app/lib/feature-flags';

const originalEnv = process.env;

function setEnv(vars: Record<string, string | undefined>) {
  process.env = { ...originalEnv };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('demo-data flag guard (#1306)', () => {
  beforeEach(() => {
    setEnv({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('honours a demo-data flag outside a production build', () => {
    setEnv({ NODE_ENV: 'development' });

    expect(isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, 'true')).toBe(true);
    expect(isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, 'TRUE')).toBe(true);
    expect(isDemoDataFlagEnabled(DISPUTE_MOCK_DATA_FLAG, 'true')).toBe(true);
  });

  it('refuses a demo-data flag in a production build', () => {
    setEnv({ NODE_ENV: 'production' });

    expect(isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, 'true')).toBe(false);
    expect(isDemoDataFlagEnabled(DISPUTE_MOCK_DATA_FLAG, 'true')).toBe(false);
  });

  it('logs the refusal so the misconfiguration is visible in build and runtime logs', () => {
    setEnv({ NODE_ENV: 'production' });

    isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, 'true');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`${ACTIVITY_FIXTURES_FLAG}=true was ignored`)
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('production build'));
  });

  it('does not log when the flag is absent or not exactly true', () => {
    setEnv({ NODE_ENV: 'production' });

    for (const value of [undefined, '', 'false', '1', 'yes', 'true-ish']) {
      expect(isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, value)).toBe(false);
    }

    expect(console.error).not.toHaveBeenCalled();
  });

  it('ignores NODE_ENV entirely when the flag is not enabled', () => {
    setEnv({ NODE_ENV: 'production' });
    expect(isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, 'false')).toBe(false);

    setEnv({ NODE_ENV: 'development' });
    expect(isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, 'false')).toBe(false);
  });

  it('routes the dispute mock-data flag through the same guard', () => {
    setEnv({ NODE_ENV: 'production', NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA: 'true' });
    expect(isDisputeMockDataEnabled()).toBe(false);

    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA: 'true' });
    expect(isDisputeMockDataEnabled()).toBe(true);
  });

  it('reports the production build from the inlined NODE_ENV', () => {
    setEnv({ NODE_ENV: 'production' });
    expect(isProductionBuild()).toBe(true);

    setEnv({ NODE_ENV: 'development' });
    expect(isProductionBuild()).toBe(false);

    setEnv({ NODE_ENV: undefined });
    expect(isProductionBuild()).toBe(false);
  });

  it('reads the activity fixtures flag from the environment', () => {
    // This is the entry point the activity components use, so it has to honour
    // the same production refusal as the underlying helper.
    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_ACTIVITY_FIXTURES: 'true' });
    expect(areActivityFixturesEnabled()).toBe(true);

    setEnv({ NODE_ENV: 'production', NEXT_PUBLIC_ACTIVITY_FIXTURES: 'true' });
    expect(areActivityFixturesEnabled()).toBe(false);

    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_ACTIVITY_FIXTURES: 'false' });
    expect(areActivityFixturesEnabled()).toBe(false);

    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_ACTIVITY_FIXTURES: undefined });
    expect(areActivityFixturesEnabled()).toBe(false);
  });
});
