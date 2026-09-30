export const ORACLE_MANAGEMENT_PLACEHOLDER_FLAG =
  'NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER';

export const DISPUTE_MOCK_DATA_FLAG = 'NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA';

export const ACTIVITY_FIXTURES_FLAG = 'NEXT_PUBLIC_ACTIVITY_FIXTURES';

type NodeEnv = Record<string, string | undefined>;
function readEnv(): NodeEnv {
  return ((globalThis as { process?: { env?: NodeEnv } }).process?.env) ?? {};
}

/**
 * True when the bundle was produced by a production build.
 *
 * Next.js inlines `NODE_ENV` at build time, so this is a property of the
 * deployed artifact rather than a runtime toggle.
 */
export function isProductionBuild(): boolean {
  return readEnv().NODE_ENV === 'production';
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * Resolve a flag that substitutes fabricated data for real chain data.
 *
 * #1306 — these flags are `NEXT_PUBLIC_*`, so the value is inlined into the
 * client bundle at build time: setting one is a property of the built artifact,
 * not a runtime switch. A preview or staging build that copied `.env` values
 * would therefore serve fake rows to real users, and because nothing at runtime
 * distinguished fixture rows from real `place_bet` / `settle_pool` events, a
 * reader judging whether a market was being manipulated could not tell.
 *
 * So a demo-data flag is honoured only outside a production build. Requesting
 * one in a production build is refused and logged rather than silently ignored,
 * so the misconfiguration is visible in build and runtime logs.
 *
 * Every flag that substitutes fabricated data for chain data routes through
 * here. A flag that fabricates and bypasses this guard is a hole in the same
 * bug, not a different feature, so a new one belongs in this function's
 * callers rather than on a second unguarded path.
 *
 * Refusing is not the whole fix: `DemoDataBanner` renders a persistent marker
 * wherever these flags *are* active, so the state is never silent.
 */
export function isDemoDataFlagEnabled(flag: string, value: string | undefined): boolean {
  if (!isExplicitlyEnabled(value)) return false;

  if (isProductionBuild()) {
    // eslint-disable-next-line no-console
    console.error(
      `[feature-flags] ${flag}=true was ignored: this is a production build and ` +
        'demo-data flags are refused there. Fabricated activity, dispute or oracle data ' +
        'must never be served to real users. Remove the variable from the build environment.'
    );
    return false;
  }

  return true;
}

function readOracleManagementPlaceholderFlag(): string | undefined {
  return readEnv()[ORACLE_MANAGEMENT_PLACEHOLDER_FLAG];
}

function readDisputeMockDataFlag(): string | undefined {
  return readEnv()[DISPUTE_MOCK_DATA_FLAG];
}

/**
 * True when fabricated pool-activity rows are being served instead of real
 * on-chain events.
 *
 * Lives here rather than in `adapters/activity` so the components that render
 * these rows can read it without importing that module, which has a pre-existing
 * broken dynamic import (`../hooks/usePoolActivity`) that fails to resolve.
 * `adapters/activity`'s `useFixtures` delegates here.
 */
export function areActivityFixturesEnabled(): boolean {
  return isDemoDataFlagEnabled(ACTIVITY_FIXTURES_FLAG, readEnv()[ACTIVITY_FIXTURES_FLAG]);
}

/**
 * True when the fixture-backed oracle management preview is being served
 * instead of live oracle administration.
 *
 * Gated by the same guard as the other demo-data flags, and for the same
 * reason: enabled in a production build it puts the fixtures in
 * `app/lib/fixtures/oracleManagement.ts` — mock providers with reliability
 * scores and resolution counts, and mock submissions with pool ids and data
 * values — in front of users who would reasonably read them as live. The
 * disabled state already claims "fixture-backed oracle actions are hidden from
 * production surfaces", which was only true while nobody set the flag.
 */
export function isOracleManagementPlaceholderEnabled(): boolean {
  return isDemoDataFlagEnabled(
    ORACLE_MANAGEMENT_PLACEHOLDER_FLAG,
    readOracleManagementPlaceholderFlag()
  );
}

export function isDisputeMockDataEnabled(): boolean {
  return isDemoDataFlagEnabled(DISPUTE_MOCK_DATA_FLAG, readDisputeMockDataFlag());
}
