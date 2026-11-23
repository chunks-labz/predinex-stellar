import { NextResponse } from 'next/server';
import { getVersionInfo } from '@/app/lib/build-info';

/**
 * GET /api/version — which build and contract this deployment runs (#1665).
 *
 * Unauthenticated and free of secrets: the body is the allowlisted
 * `VersionInfo` from `app/lib/build-info.ts`. The route is rendered at build
 * time, so it describes the build that is serving the request rather than the
 * environment of whichever function instance happens to answer.
 */
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(getVersionInfo(), {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
