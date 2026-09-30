# Oracle Management Route

This route exposes the oracle-management operational surface only through the guarded `OracleManagement` component. The route is safe to open in production builds: the fixture-backed controls stay hidden unless `NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER=true` is set, and setting it in a production build is refused rather than honoured, so fixture-backed controls cannot appear there at all (#1306).

To find the oracle-management route visit [page.tsx](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/oracle-management/page.tsx).

To find the placeholder gating and disabled production state visit [OracleManagement.tsx](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/components/OracleManagement.tsx).

The oracle-management feature flag can be found in [feature-flags.ts](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/lib/feature-flags.ts).
