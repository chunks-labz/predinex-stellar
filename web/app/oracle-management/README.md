# Oracle Management Route

This route exposes the oracle-management operational surface only through the guarded `OracleManagement` component. The route is safe to open in production builds because fixture-backed controls stay hidden unless `NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER=true` is intentionally set.

To find the oracle-management route visit [page.tsx](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/oracle-management/page.tsx).

To find the placeholder gating and disabled production state visit [OracleManagement.tsx](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/components/OracleManagement.tsx).

The oracle-management feature flag can be found in [feature-flags.ts](file:///C:/Stellar%20Contributions/predinex-stellar/web/app/lib/feature-flags.ts).
